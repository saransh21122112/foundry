import { test } from "node:test";
import assert from "node:assert/strict";
import { logToolResult } from "./log-tool-result.js";
import type { GuardrailDeps } from "@foundry/guardrails";
import type { HookEventMap, HookContext } from "eve/hooks";

/** In-memory fake, same convention as packages/guardrails/src/enforce.test.ts. */
function makeFakeDeps() {
  const log: unknown[] = [];
  const deps: Pick<GuardrailDeps, "logActivity"> = {
    logActivity: async (entry) => {
      log.push(entry);
    },
  };
  return { deps, log };
}

function makeCtx(agentName: string, orgId: string | undefined): HookContext {
  return {
    agent: { name: agentName },
    channel: {},
    session: {
      id: "session_1",
      auth: { current: orgId ? { attributes: { orgId } } : undefined },
      turn: {} as HookContext["session"]["turn"],
    },
    getSandbox: async () => {
      throw new Error("not used");
    },
    getSkill: () => {
      throw new Error("not used");
    },
  } as unknown as HookContext;
}

function makeEvent(
  overrides: Partial<HookEventMap["action.result"]["data"]>,
): HookEventMap["action.result"] {
  return {
    type: "action.result",
    data: {
      sequence: 1,
      stepIndex: 0,
      turnId: "turn_1",
      status: "completed",
      result: { kind: "tool-result", callId: "call_1", toolName: "write_file", output: { ok: true } },
      ...overrides,
    },
  } as HookEventMap["action.result"];
}

test("skips non-tool-result actions (subagent-result / load-skill-result)", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({ result: { kind: "subagent-result", callId: "c", subagentName: "eng-lead", output: {} } as never });
  await logToolResult(event, makeCtx("eng-lead", "org_1"), deps);
  assert.equal(log.length, 0);
});

test("skips a rejected call (enforce() already logged tool_call_blocked)", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({ status: "rejected" });
  await logToolResult(event, makeCtx("sales-lead", "org_1"), deps);
  assert.equal(log.length, 0);
});

test("skips a filtered read-only built-in (e.g. read_file)", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({ result: { kind: "tool-result", callId: "c", toolName: "read_file", output: {} } });
  await logToolResult(event, makeCtx("eng-lead", "org_1"), deps);
  assert.equal(log.length, 0);
});

test("skips when no org is resolved on the session", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({});
  await logToolResult(event, makeCtx("eng-lead", undefined), deps);
  assert.equal(log.length, 0);
});

test("logs a side-effecting built-in (write_file) as tool_call_executed, department = top-level agent name", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({});
  await logToolResult(event, makeCtx("eng-lead", "org_1"), deps);
  assert.equal(log.length, 1);
  const entry = log[0] as { eventType: string; department: string; agentNodeId?: string };
  assert.equal(entry.eventType, "tool_call_executed");
  assert.equal(entry.department, "eng-lead");
  assert.equal(entry.agentNodeId, undefined);
});

test("a failed call logs tool_call_failed with the error message", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({ status: "failed", error: { code: "E", message: "boom" } });
  await logToolResult(event, makeCtx("sales-lead", "org_1"), deps);
  assert.equal(log.length, 1);
  const entry = log[0] as { eventType: string; toolOutput: { error: string } };
  assert.equal(entry.eventType, "tool_call_failed");
  assert.equal(entry.toolOutput.error, "boom");
});

test("a nested delegate (code-reviewer) is attributed to its parent department, with agentNodeId set", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({});
  await logToolResult(event, makeCtx("code-reviewer", "org_1"), deps);
  assert.equal(log.length, 1);
  const entry = log[0] as { department: string; agentNodeId?: string };
  assert.equal(entry.department, "eng-lead");
  assert.equal(entry.agentNodeId, "eng-lead/code-reviewer");
});

test("an unrecognized agent name (e.g. the root orchestrator) logs nothing", async () => {
  const { deps, log } = makeFakeDeps();
  const event = makeEvent({});
  await logToolResult(event, makeCtx("agent-runtime", "org_1"), deps);
  assert.equal(log.length, 0);
});
