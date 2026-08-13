import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import * as pty from "node-pty";

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
 * calls appear through eve's own session/stream API (apps/web's
 * agent-stream proxy), not this PTY — this file no longer runs its own
 * parallel agent loop (that dormant /run + /stream pair was removed,
 * 2026-08-14: unused, no DB persistence, and eve's real ops-manager
 * subagent already does this for real).
 *
 * One PTY per session id, spawned lazily on first WS connection and kept
 * alive across disconnects — a socket closing (switching tabs, a page
 * reload) only detaches it, it does NOT kill the shell. Only a long idle
 * stretch with nobody attached kills it (evictIdleTerminals below); this
 * replaced an earlier "kill on every close" behavior that made switching
 * tabs and back look like a clean-slate crash (confirmed live,
 * 2026-08-13) even though the shell itself was fine — session ids used to
 * be minted fresh per page mount too, so there was nothing stable to
 * reattach to even if the kill hadn't happened.
 */
const TERMINAL_IDLE_TTL_MS = 2 * 60 * 60_000; // no attached socket for this long -> kill it
const TERMINAL_BUFFER_MAX_BYTES = 64_000; // recent scrollback replayed to a newly (re)attached socket

interface TerminalEntry {
  pty: pty.IPty;
  buffer: string;
  attachedSockets: number;
  lastDetachedAt: number | null;
}
const terminals = new Map<string, TerminalEntry>();

// Persistent home per org, not this container's own ephemeral filesystem —
// lives on the same EFS volume eve's own workflow state already uses (see
// WorkflowStateFs / workflowAccessPoint in infra/lib/foundry-stack.ts,
// mounted at .eve/.workflow-data relative to this process's cwd). That's
// what makes Claude Code's config/credentials, any plugins installed from
// inside this terminal, and shell history survive a container restart,
// redeploy, or the user just logging out and back in — none of which
// should wipe a shell that's conceptually "this org's own box".
// sessionId is "term-<orgId>" (see apps/web's terminal-token route); any
// other shape falls back to a scratch dir under /tmp rather than guessing.
function terminalHomeDir(sessionId: string): string {
  const orgId = sessionId.startsWith("term-") ? sessionId.slice("term-".length) : null;
  const base = process.env.EVE_WORKFLOW_DATA_DIR ?? ".eve/.workflow-data";
  // Must be absolute, not just resolvable-as-cwd: this becomes $HOME, and
  // unlike pty.spawn's own `cwd` option (which the OS resolves against the
  // real process cwd on chdir), env vars are passed through verbatim — a
  // relative HOME stayed relative while `pwd` reported the real resolved
  // path, so anything joining "$(pwd)/$HOME" (confirmed live: Claude Code
  // itself, looking for its plugin marketplace file) silently doubled the
  // whole terminal-homes/<org> segment into a nested, growing path.
  const dir = orgId
    ? path.resolve(base, "terminal-homes", orgId)
    : path.resolve("/tmp", "terminal-homes", sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnTerminal(sessionId: string): TerminalEntry {
  const existing = terminals.get(sessionId);
  if (existing) return existing;
  const shell = process.env.SHELL ?? "bash";
  const home = terminalHomeDir(sessionId);
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
    HOME: home,
    TERM: "xterm-color",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  // Deliberate, narrow exception to the allowlist above: the Claude Code
  // CLI installed in this image (see Dockerfile) needs this to
  // authenticate, and running `claude` inside the real terminal was
  // explicitly requested. Same "operating your own environment" trust
  // boundary as exec_host.ts already accepts, not a new one — this
  // terminal is already gated to org:admin only (see
  // /api/terminal-token). Every OTHER secret (Clerk, Stripe, DB creds,
  // etc.) stays excluded; this is the one exception, not a reopening of
  // the original leak.
  if (process.env.ANTHROPIC_API_KEY) safeEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: home,
    env: safeEnv,
  });
  const entry: TerminalEntry = { pty: term, buffer: "", attachedSockets: 0, lastDetachedAt: null };
  // Kept independent of any single WS's onData subscription below, so the
  // buffer keeps accumulating (and can be replayed) even during the gap
  // between a tab closing and a new one reattaching.
  term.onData((data) => {
    entry.buffer += data;
    if (entry.buffer.length > TERMINAL_BUFFER_MAX_BYTES) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - TERMINAL_BUFFER_MAX_BYTES);
    }
  });
  term.onExit(() => terminals.delete(sessionId));
  terminals.set(sessionId, entry);
  return entry;
}

function evictIdleTerminals(): void {
  const cutoff = Date.now() - TERMINAL_IDLE_TTL_MS;
  for (const [id, entry] of terminals) {
    if (entry.attachedSockets === 0 && entry.lastDetachedAt !== null && entry.lastDetachedAt < cutoff) {
      entry.pty.kill();
      terminals.delete(id);
    }
  }
}
setInterval(evictIdleTerminals, 10 * 60_000).unref();

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
  const entry = spawnTerminal(sessionId);
  const term = entry.pty;
  entry.attachedSockets++;
  entry.lastDetachedAt = null;

  // Replay recent scrollback immediately so a reattaching socket (tab
  // switch, page reload) shows the shell as it actually is instead of a
  // blank screen until the next keypress.
  if (entry.buffer && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "data", data: entry.buffer }));
  }

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
    entry.attachedSockets--;
    if (entry.attachedSockets === 0) entry.lastDetachedAt = Date.now();
  });
}

server.listen(PORT, () => {
  console.log(`[runtime-core] listening on :${PORT}`);
});
