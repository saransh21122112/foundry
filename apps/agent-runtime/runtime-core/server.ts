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
}
const sessions = new Map<string, Session>();

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

  if (req.method === "POST" && url.pathname === "/runtime-core/v1/run") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
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

      const sessionId = randomUUID();
      sessions.set(sessionId, { events: [], done: false, emitter: new EventEmitter() });
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
