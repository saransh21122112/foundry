import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, organizations, runSessions } from "./index.js";

/**
 * Regression test for the cross-tenant IDOR fixed in
 * apps/web/app/dashboard/run/actions.ts's sendFollowUp and
 * apps/web/app/api/agent-stream/[sessionId]/route.ts (2026-08-02): both now
 * scope their session lookup to `(sessionId, orgId)` instead of trusting a
 * client-supplied sessionId alone. This exercises that exact query pattern
 * against the real dev DB (no fake-DB layer exists for this package, same
 * as every other query here).
 */
test("a run_sessions lookup scoped to the wrong org returns nothing, scoped to the right org returns the row", async () => {
  const suffix = Math.random().toString(36).slice(2);
  const [orgA] = await db
    .insert(organizations)
    .values({ clerkOrgId: `test-org-a-${suffix}`, name: "Test Org A", slug: `test-org-a-${suffix}` })
    .returning({ id: organizations.id });
  const [orgB] = await db
    .insert(organizations)
    .values({ clerkOrgId: `test-org-b-${suffix}`, name: "Test Org B", slug: `test-org-b-${suffix}` })
    .returning({ id: organizations.id });

  const sessionId = `wrun_test_${suffix}`;

  try {
    await db.insert(runSessions).values({
      id: sessionId,
      orgId: orgA.id,
      createdByClerkUserId: "test_user",
      title: "test session",
    });

    const asOrgB = await db
      .select({ id: runSessions.id })
      .from(runSessions)
      .where(and(eq(runSessions.id, sessionId), eq(runSessions.orgId, orgB.id)))
      .limit(1);
    assert.equal(asOrgB.length, 0);

    const asOrgA = await db
      .select({ id: runSessions.id })
      .from(runSessions)
      .where(and(eq(runSessions.id, sessionId), eq(runSessions.orgId, orgA.id)))
      .limit(1);
    assert.equal(asOrgA.length, 1);
    assert.equal(asOrgA[0]?.id, sessionId);
  } finally {
    await db.delete(runSessions).where(eq(runSessions.id, sessionId));
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
  }
});
