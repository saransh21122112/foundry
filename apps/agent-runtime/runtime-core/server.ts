import { createServer } from "node:http";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { gateway } from "ai";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";
import { runAgentLoop, type AgentLoopEvent } from "@foundry/agent-runtime-core";
import { opsManagerTools } from "./ops-manager-tools.js";
import { makeGuardrailsBeforeToolCall } from "./guardrails-hook.js";
import { resolveInstructions } from "./resolve-instructions.js";
import defaultInstructions from "../agent/subagents/ops-manager/instructions.default.js";

const PORT = Number(process.env.RUNTIME_CORE_PORT ?? 3313);

// Internal-only server (no auth of its own before this fix — flagged by
// automated security review, correctly: unlike every other entry point
// in this app, nothing here verified the caller at all, so any request
// reaching this port could run a session as an arbitrary orgId or read
// another org's session stream). apps/web is the only intended caller,
// same trust boundary as AGENT_RUNTIME_URL already has — a shared
// bearer token is the pragmatic fix for a Phase 0 proof, not a full
// per-user auth chain. Required, not optional: refuses to start without
// it rather than silently running unauthenticated.
const INTERNAL_TOKEN = process.env.RUNTIME_CORE_INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) {
  throw new Error("RUNTIME_CORE_INTERNAL_TOKEN must be set — this server has no other request auth.");
}

function isAuthorized(req: import("node:http").IncomingMessage): boolean {
  const header = req.headers.authorization;
  return header === `Bearer ${INTERNAL_TOKEN}`;
}

// Short-lived terminal tokens: the browser's native WebSocket API can't
// send an Authorization header, and the long-lived INTERNAL_TOKEN must
// never reach client-side JS (it'd let any browser holding it open a
// terminal on ANY session, not just ones the org owns). apps/web (which
// already checked Clerk auth + run_sessions org ownership, same as the
// existing agent-stream proxy) mints one of these server-to-server via
// POST /runtime-core/v1/terminal-token, then hands only this narrow,
// expiring, session-scoped token to the browser. HMAC over the
// INTERNAL_TOKEN, not a new secret — one fewer thing to provision/rotate,
// and possessing it already implies the same trust level.
const TERMINAL_TOKEN_TTL_MS = 5 * 60_000;

function signTerminalToken(sessionId: string, expiresAt: number): string {
  const mac = createHmac("sha256", INTERNAL_TOKEN!).update(`${sessionId}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${mac}`;
}

function verifyTerminalToken(sessionId: string, token: string): boolean {
  const [expiresAtStr, mac] = token.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!expiresAtStr || !mac || Number.isNaN(expiresAt) || Date.now() > expiresAt) return false;
  const expected = createHmac("sha256", INTERNAL_TOKEN!).update(`${sessionId}.${expiresAt}`).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Also flagged: unbounded request bodies and an unbounded, never-evicted
// session map — both real resource-exhaustion vectors for a long-lived
// process. Bounds below are proof-level, not tuned for production load.
const MAX_BODY_BYTES = 100_000;
const MAX_SESSIONS = 1000;
const SESSION_TTL_MS = 60 * 60_000;

/**
 * In-memory session store — a proof-of-migration limitation, not an
 * oversight: no persistence across a server restart. Building a real
 * `agent_sessions`/`agent_messages` table is named as follow-up work
 * (see the Phase 0 plan); premature for a proof that might get thrown
 * away. Each session's `events` array is the full replay log the stream
 * endpoint reads from; `emitter` fans out new events to any listener
 * currently attached to GET .../stream.
 */
interface Session {
  events: AgentLoopEvent[];
  done: boolean;
  emitter: EventEmitter;
  createdAt: number;
}
const sessions = new Map<string, Session>();

function evictStaleSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.done && session.createdAt < cutoff) sessions.delete(id);
  }
  // Still over the cap after TTL eviction (e.g. many sessions created
  // within one TTL window) — drop the oldest completed ones first.
  if (sessions.size > MAX_SESSIONS) {
    const completed = [...sessions.entries()]
      .filter(([, s]) => s.done)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of completed) {
      if (sessions.size <= MAX_SESSIONS) break;
      sessions.delete(id);
    }
  }
}
setInterval(evictStaleSessions, 5 * 60_000).unref();

/**
 * Real live terminal — a genuine PTY (node-pty), not a command-request/
 * response loop. This is what a live PTY needs that eve doesn't support:
 * a way to attach a raw bidirectional stream to a long-lived process from
 * outside any single tool execution. Scoped honestly: this is a human-
 * typed shell into the session's own host process (same "operating your
 * own environment" trust boundary as exec_host.ts — real arrow-key
 * history, ANSI escapes, full-screen programs all work, since it's a
 * real pty, not a fake one).
 *
 * NOT wired: ops-manager's own tools (get_daily_ops_digest, place_call,
 * etc.) don't run shell commands at all — there's no exec-style tool on
 * this department to merge into the shared terminal stream. Agent tool
 * calls still only appear via the existing NDJSON event stream
 * (GET .../stream), not this PTY. Named in the plan as an acceptable
 * fallback rather than forcing something that doesn't apply here.
 *
 * One PTY per session, spawned lazily on first WS connection, killed
 * when the WS closes — no reconnect-to-a-still-running-shell in this
 * pass (a real limitation, not an oversight: keeping orphaned shells
 * alive indefinitely after a client disconnects is its own resource-
 * exhaustion problem, deliberately not taken on here).
 */
const terminals = new Map<string, pty.IPty>();

function spawnTerminal(sessionId: string): pty.IPty {
  const existing = terminals.get(sessionId);
  if (existing) return existing;
  const shell = process.env.SHELL ?? "bash";
  // Explicit allowlist, not `process.env` wholesale — this container's env
  // holds every secret the app has (CLERK_SECRET_KEY, ANTHROPIC_API_KEY,
  // DATABASE_URL, RUNTIME_CORE_INTERNAL_TOKEN, TWILIO/GITHUB/GOOGLE
  // creds…), and anyone who can open this terminal could otherwise just
  // `echo $ANTHROPIC_API_KEY` to read them straight out. Flagged by
  // automated security review; fixed here rather than dismissed — real
  // exposure, not a theoretical one. PATH/HOME/TERM/LANG is enough for a
  // normal interactive shell.
  const safeEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TERM: "xterm-color",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  const term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: safeEnv,
  });
  terminals.set(sessionId, term);
  term.onExit(() => terminals.delete(sessionId));
  return term;
}

async function runSession(sessionId: string, orgId: string, message: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const emit = (event: AgentLoopEvent) => {
    session.events.push(event);
    session.emitter.emit("event", event);
  };

  try {
    const system = await resolveInstructions("ops-manager", "ops-manager", orgId, defaultInstructions);
    const beforeToolCall = makeGuardrailsBeforeToolCall({ orgId, agentRunId: sessionId });

    const loop = runAgentLoop({
      // apps/agent-runtime has no real ANTHROPIC_API_KEY in this env, only
      // AI_GATEWAY_API_KEY (Vercel AI Gateway) — using the gateway's own
      // model id keeps this a real, live LLM call instead of a stub.
      model: gateway("anthropic/claude-sonnet-5"),
      system,
      tools: opsManagerTools,
      ctx: { session: { auth: { current: { attributes: { orgId } } } } },
      beforeToolCall,
      messages: [{ role: "user", content: message }],
    });

    for await (const event of loop) {
      emit(event);
    }
  } catch (err) {
    emit({ type: "message.completed", text: `Error: ${err instanceof Error ? err.message : String(err)}` });
    emit({ type: "turn.completed" });
  } finally {
    session.done = true;
    session.emitter.emit("done");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Unauthenticated on purpose — the ALB target group health check has no
  // way to send the bearer token, same reason eve's own health route
  // (/eve/v1/health) isn't gated either.
  if (req.method === "GET" && url.pathname === "/runtime-core/v1/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/runtime-core/v1/run") {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "request body too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      let parsed: { orgId?: unknown; message?: unknown };
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      if (typeof parsed.orgId !== "string" || typeof parsed.message !== "string") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "orgId and message are both required strings" }));
        return;
      }

      evictStaleSessions();
      const sessionId = randomUUID();
      sessions.set(sessionId, { events: [], done: false, emitter: new EventEmitter(), createdAt: Date.now() });
      // Start now, stream progress separately — same shape RunBoard.tsx
      // already expects from eve, per the Phase 0 plan. Not awaited.
      void runSession(sessionId, parsed.orgId, parsed.message);

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId }));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/runtime-core/v1/terminal-token") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed: { sessionId?: unknown };
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      if (typeof parsed.sessionId !== "string" || !parsed.sessionId) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "sessionId is required" }));
        return;
      }
      const expiresAt = Date.now() + TERMINAL_TOKEN_TTL_MS;
      const token = signTerminalToken(parsed.sessionId, expiresAt);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token, expiresAt }));
    });
    return;
  }

  const streamMatch = url.pathname.match(/^\/runtime-core\/v1\/session\/([^/]+)\/stream$/);
  if (req.method === "GET" && streamMatch) {
    const sessionId = decodeURIComponent(streamMatch[1]);
    const session = sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown session id" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
    for (const event of session.events) {
      res.write(JSON.stringify(event) + "\n");
    }
    if (session.done) {
      res.end();
      return;
    }

    const onEvent = (event: AgentLoopEvent) => res.write(JSON.stringify(event) + "\n");
    const onDone = () => res.end();
    session.emitter.on("event", onEvent);
    session.emitter.on("done", onDone);
    req.on("close", () => {
      session.emitter.off("event", onEvent);
      session.emitter.off("done", onDone);
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

// WS upgrade requests never carry a normal Authorization header from a
// browser's native WebSocket API — the token travels as a query param
// instead, checked before the upgrade completes (same 401-equivalent
// semantics as the HTTP routes: refuse the socket outright, don't accept
// then error).
//
// APP_ORIGINS: an explicit allowlist, checked against the upgrade
// request's Origin header before anything else — without it, any page
// anywhere that got hold of a valid (even short-lived) token could open
// this socket cross-site. Flagged by automated security review; fixed
// here. Comma-separated, e.g. "https://app.example.com". Empty/unset
// means "same-origin only isn't enforceable" — treated as a misconfig,
// not silently open: the check below fails closed if this isn't set.
const ALLOWED_ORIGINS = new Set((process.env.APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean));

const wss = new WebSocketServer({ noServer: true });
const terminalRouteMatch = /^\/runtime-core\/v1\/session\/([^/]+)\/terminal$/;

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const match = url.pathname.match(terminalRouteMatch);
  const token = url.searchParams.get("token");
  const sessionId = match ? decodeURIComponent(match[1]) : "";
  const origin = req.headers.origin ?? "";

  // Only the short-lived, session-scoped signed token is accepted here —
  // NOT the long-lived static INTERNAL_TOKEN. That token also travels in
  // this URL's query string (logs, proxies, browser history all see it),
  // so accepting it here would mean a single leaked query-string value
  // grants everything INTERNAL_TOKEN grants, not just one terminal.
  // Server-to-server callers mint a scoped token via the HTTP route
  // instead (which does still use INTERNAL_TOKEN, over an Authorization
  // header, never a URL). Flagged by automated security review; fixed
  // here rather than dismissed.
  const authorized = !!match && !!token && verifyTerminalToken(sessionId, token) && ALLOWED_ORIGINS.has(origin);
  if (!authorized) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    attachTerminal(ws, sessionId);
  });
});

function attachTerminal(ws: WebSocket, sessionId: string): void {
  const term = spawnTerminal(sessionId);

  const onData = term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "data", data }));
  });

  ws.on("message", (raw) => {
    let msg: { type?: string; data?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // A message can arrive after the underlying PTY's fd is already gone
    // (e.g. a queued resize racing the process exiting) — node-pty throws
    // synchronously in that case (confirmed live: "ioctl(2) failed,
    // EBADF" from term.resize()), and an uncaught throw inside a
    // WebSocket 'message' handler crashes the whole Node process, taking
    // down both eve and runtime-core (see start.mjs) and putting the ECS
    // service into a genuine crash loop — this wasn't a rare edge case,
    // it reproduced on effectively every real terminal connection. Catch
    // and ignore: the PTY being gone just means this message is stale,
    // not a real error worth crashing over.
    try {
      if (msg.type === "input" && typeof msg.data === "string") {
        term.write(msg.data);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        term.resize(msg.cols, msg.rows);
      }
    } catch (err) {
      console.error(`[runtime-core] terminal write/resize failed for session ${sessionId}:`, err);
    }
  });

  ws.on("close", () => {
    onData.dispose();
    term.kill();
    terminals.delete(sessionId);
  });
}

server.listen(PORT, () => {
  console.log(`[runtime-core] listening on :${PORT}`);
});
