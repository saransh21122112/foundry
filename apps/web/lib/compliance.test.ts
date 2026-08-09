import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileClaims, type ApprovalRow, type ExecutionRow } from "./compliance.js";

function execution(overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    id: "exec_1",
    department: "sales-lead",
    toolName: "issue_refund",
    agentRunId: "run_1",
    riskClass: "financial",
    timestamp: new Date("2026-08-01T12:00:00Z"),
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "approval_1",
    department: "sales-lead",
    toolName: "issue_refund",
    agentRunId: "run_1",
    status: "approved",
    reason: "hard_rule:financial",
    resolvedAt: new Date("2026-08-01T11:00:00Z"),
    ...overrides,
  };
}

test("an execution with a prior approval in the same run satisfies claim A, no violations", () => {
  const { claimA, claimB } = reconcileClaims([execution()], [approval()]);
  assert.equal(claimA.total, 1);
  assert.equal(claimA.matched, 1);
  assert.deepEqual(claimA.violations, []);
  assert.equal(claimB.totalRejected, 0);
  assert.deepEqual(claimB.violations, []);
});

test("an execution with no matching approval is flagged as a claim A violation", () => {
  const { claimA } = reconcileClaims([execution()], []);
  assert.equal(claimA.total, 1);
  assert.equal(claimA.matched, 0);
  assert.equal(claimA.violations.length, 1);
  assert.equal(claimA.violations[0].id, "exec_1");
});

test("a rejected hard-rule request with no later execution honors claim B", () => {
  const rejected = approval({ id: "approval_rejected", status: "rejected", reason: "hard_rule:financial" });
  const { claimB } = reconcileClaims([], [rejected]);
  assert.equal(claimB.totalRejected, 1);
  assert.equal(claimB.correctlyBlocked, 1);
  assert.deepEqual(claimB.violations, []);
});

test("a rejected hard-rule request followed by an execution anyway is a claim B violation", () => {
  const rejected = approval({
    id: "approval_rejected",
    status: "rejected",
    reason: "hard_rule:financial",
    resolvedAt: new Date("2026-08-01T10:00:00Z"),
  });
  const exec = execution({ id: "exec_after_rejection", timestamp: new Date("2026-08-01T10:30:00Z") });
  const { claimB } = reconcileClaims([exec], [rejected]);
  assert.equal(claimB.totalRejected, 1);
  assert.equal(claimB.correctlyBlocked, 0);
  assert.equal(claimB.violations.length, 1);
});
