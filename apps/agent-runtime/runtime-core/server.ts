import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { gateway } from "ai";
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

server.listen(PORT, () => {
  console.log(`[runtime-core] listening on :${PORT}`);
});
