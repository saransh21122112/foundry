import { test } from "node:test";
import assert from "node:assert/strict";
import { enforce } from "./enforce.js";
import type { EnforceContext, GuardrailDeps, ToolCall } from "./types.js";

const ctx: EnforceContext = { orgId: "org_1", department: "sales-lead", agentRunId: "run_1" };

/** In-memory fake — every test below runs with zero DB/network dependency. */
function makeFakeDeps(overrides: Partial<GuardrailDeps> = {}): GuardrailDeps {
  const log: unknown[] = [];
  return {
    isKillSwitchActive: async () => false,
    isDepartmentEnabled: async () => true,
    getAutonomyLevel: async () => "bounded_autonomous",
    isToolAllowed: async () => true,
    checkAndReserveBudget: async () => ({ withinBudget: true }),
    checkRateLimit: async () => true,
    createApprovalRequest: async () => ({ id: "approval_1" }),
    logActivity: async (entry) => {
      log.push(entry);
    },
    ...overrides,
  };
}

const readTool: ToolCall = { name: "list_leads", input: {}, riskClass: "reversible-low" };
const sendTool: ToolCall = { name: "send_email", input: { to: "a@b.com" }, riskClass: "reversible-high" };
const refundTool: ToolCall = { name: "issue_refund", input: { amount: 50 }, riskClass: "financial" };

test("kill switch blocks everything, including reads", async () => {
  const deps = makeFakeDeps({ isKillSwitchActive: async () => true });
  const result = await enforce(ctx, readTool, deps);
  assert.equal(result.verdict, "deny");
  assert.match((result as any).reason, /kill_switch/);
});

test("a disabled department blocks everything, even at bounded_autonomous", async () => {
  const deps = makeFakeDeps({ isDepartmentEnabled: async () => false });
  const result = await enforce(ctx, readTool, deps);
  assert.equal(result.verdict, "deny");
  assert.equal((result as any).reason, "department_disabled");
});

test("autonomy=off blocks everything", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "off" });
  const result = await enforce(ctx, readTool, deps);
  assert.equal(result.verdict, "deny");
  assert.equal((result as any).reason, "autonomy_off");
});

test("autonomy=draft_only allows reads but queues side-effecting calls", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "draft_only" });

  const readResult = await enforce(ctx, readTool, deps);
  assert.equal(readResult.verdict, "allow");

  const sendResult = await enforce(ctx, sendTool, deps);
  assert.equal(sendResult.verdict, "require_approval");
  assert.equal((sendResult as any).reason, "draft_mode");
});

test("a financial/irreversible/legal riskClass always requires approval, even when bounded_autonomous", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "bounded_autonomous" });
  const result = await enforce(ctx, refundTool, deps);
  assert.equal(result.verdict, "require_approval");
  assert.match((result as any).reason, /^hard_rule:/);
});

test("budget exceeded queues for approval instead of executing", async () => {
  const deps = makeFakeDeps({ checkAndReserveBudget: async () => ({ withinBudget: false }) });
  const result = await enforce(ctx, { ...sendTool, estimatedCost: { unit: "usd", amount: 5 } }, deps);
  assert.equal(result.verdict, "require_approval");
  assert.equal((result as any).reason, "budget_exceeded");
});

test("a tool not on the allowlist is denied outright, not queued", async () => {
  const deps = makeFakeDeps({ isToolAllowed: async () => false });
  const result = await enforce(ctx, sendTool, deps);
  assert.equal(result.verdict, "deny");
  assert.equal((result as any).reason, "not_in_allowlist");
});

test("rate limit exceeded queues for approval", async () => {
  const deps = makeFakeDeps({ checkRateLimit: async () => false });
  const result = await enforce(ctx, sendTool, deps);
  assert.equal(result.verdict, "require_approval");
  assert.equal((result as any).reason, "rate_limit_exceeded");
});

test("everything passing returns allow", async () => {
  const deps = makeFakeDeps();
  const result = await enforce(ctx, sendTool, deps);
  assert.equal(result.verdict, "allow");
});

test("every enforce() call logs exactly one attempted event, regardless of outcome", async () => {
  const events: string[] = [];
  const deps = makeFakeDeps({
    getAutonomyLevel: async () => "off",
    logActivity: async (entry) => {
      events.push(entry.eventType);
    },
  });
  await enforce(ctx, readTool, deps);
  assert.equal(events.filter((e) => e === "tool_call_attempted").length, 1);
  assert.equal(events.filter((e) => e === "tool_call_blocked").length, 1);
});

test("an allowed call logs attempted then allowed, nothing else", async () => {
  const events: string[] = [];
  const deps = makeFakeDeps({
    logActivity: async (entry) => {
      events.push(entry.eventType);
    },
  });
  await enforce(ctx, readTool, deps);
  assert.deepEqual(events, ["tool_call_attempted", "tool_call_allowed"]);
});
