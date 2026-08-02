import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBudgetDecision, type BudgetCapRow } from "./budget-decision.js";

const now = new Date("2026-08-02T12:00:00Z");

function row(overrides: Partial<BudgetCapRow> = {}): BudgetCapRow {
  return {
    id: "cap_1",
    department: "sales-lead",
    scope: "daily",
    unit: "usd",
    capAmount: 100,
    periodStart: now,
    currentSpend: 0,
    ...overrides,
  };
}

test("blocked by the department cap alone denies, even if the org-wide cap has room", () => {
  const deptCap = row({ id: "dept", department: "sales-lead", capAmount: 10, currentSpend: 9 });
  const orgCap = row({ id: "org", department: null, capAmount: 1000, currentSpend: 0 });
  const decision = computeBudgetDecision([deptCap, orgCap], { unit: "usd", amount: 5 }, now);
  assert.equal(decision.verdict, "deny");
});

test("blocked by the org-wide cap alone denies, even if the department cap has room", () => {
  const deptCap = row({ id: "dept", department: "sales-lead", capAmount: 1000, currentSpend: 0 });
  const orgCap = row({ id: "org", department: null, capAmount: 10, currentSpend: 9 });
  const decision = computeBudgetDecision([deptCap, orgCap], { unit: "usd", amount: 5 }, now);
  assert.equal(decision.verdict, "deny");
});

test("allowed by both caps updates both rows' currentSpend", () => {
  const deptCap = row({ id: "dept", department: "sales-lead", capAmount: 100, currentSpend: 10 });
  const orgCap = row({ id: "org", department: null, capAmount: 100, currentSpend: 20 });
  const decision = computeBudgetDecision([deptCap, orgCap], { unit: "usd", amount: 5 }, now);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.updates.length, 2);
  const byId = Object.fromEntries(decision.updates.map((u) => [u.id, u]));
  assert.equal(byId.dept.currentSpend, 15);
  assert.equal(byId.org.currentSpend, 25);
});

test("a daily-scope row more than 24h past periodStart rolls over to 0 spend and resets periodStart", () => {
  const stale = row({
    id: "daily",
    scope: "daily",
    capAmount: 100,
    currentSpend: 99, // would block if not rolled over
    periodStart: new Date(now.getTime() - 25 * 60 * 60 * 1000),
  });
  const decision = computeBudgetDecision([stale], { unit: "usd", amount: 10 }, now);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.updates.length, 1);
  assert.equal(decision.updates[0]?.currentSpend, 10); // 0 (rolled over) + 10
  assert.deepEqual(decision.updates[0]?.periodStart, now);
});

test("a monthly-scope row more than 30 days past periodStart rolls over the same way", () => {
  const stale = row({
    id: "monthly",
    scope: "monthly",
    capAmount: 100,
    currentSpend: 99,
    periodStart: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
  });
  const decision = computeBudgetDecision([stale], { unit: "usd", amount: 10 }, now);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.updates[0]?.currentSpend, 10);
  assert.deepEqual(decision.updates[0]?.periodStart, now);
});

test("per_run rows compare cost.amount directly against capAmount and never appear in updates", () => {
  const perRun = row({ id: "per_run", scope: "per_run", capAmount: 20, currentSpend: 999 });
  const allowed = computeBudgetDecision([perRun], { unit: "usd", amount: 15 }, now);
  assert.equal(allowed.verdict, "allow");
  assert.equal(allowed.updates.length, 0);

  const denied = computeBudgetDecision([perRun], { unit: "usd", amount: 25 }, now);
  assert.equal(denied.verdict, "deny");
});

test("zero matching rows allows with no updates", () => {
  const decision = computeBudgetDecision([], { unit: "usd", amount: 5 }, now);
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.updates, []);
});
