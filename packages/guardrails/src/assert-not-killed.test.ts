import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNotKilled } from "./assert-not-killed.js";
import type { GuardrailDeps } from "./types.js";

const ctx = { orgId: "org_1", department: "eng-lead" as const };

/** Same in-memory-fake pattern as enforce.test.ts. */
function makeFakeDeps(overrides: Partial<GuardrailDeps> = {}): GuardrailDeps {
  return {
    isKillSwitchActive: async () => false,
    isDepartmentEnabled: async () => true,
    getAutonomyLevel: async () => "bounded_autonomous",
    isToolAllowed: async () => true,
    checkAndReserveBudget: async () => ({ withinBudget: true }),
    checkRateLimit: async () => true,
    createApprovalRequest: async () => ({ id: "approval_1" }),
    logActivity: async () => {},
    ...overrides,
  };
}

test("passes when neither killed nor disabled", async () => {
  await assertNotKilled(ctx, makeFakeDeps());
});

test("throws when the kill switch is active", async () => {
  const deps = makeFakeDeps({ isKillSwitchActive: async () => true });
  await assert.rejects(() => assertNotKilled(ctx, deps), /kill switch/);
});

test("throws when the department is disabled, even with no kill switch", async () => {
  const deps = makeFakeDeps({ isDepartmentEnabled: async () => false });
  await assert.rejects(() => assertNotKilled(ctx, deps), /turned off/);
});

test("throws when autonomy level is off, even with no kill switch and department enabled", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "off" });
  await assert.rejects(() => assertNotKilled(ctx, deps), /autonomy level set to Off/);
});

test("passes when autonomy level is draft_only", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "draft_only" });
  await assertNotKilled(ctx, deps);
});

test("passes when autonomy level is bounded_autonomous", async () => {
  const deps = makeFakeDeps({ getAutonomyLevel: async () => "bounded_autonomous" });
  await assertNotKilled(ctx, deps);
});
