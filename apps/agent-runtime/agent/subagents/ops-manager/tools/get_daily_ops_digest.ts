import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, activityLog, approvalRequests } from "@foundry/db";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Ops-manager's own read tool, modeled directly on data-lead's
 * get_activity_summary.ts (same org-scoping, same assertNotKilled-only
 * gate — a pure read with riskClass "reversible-low" skips the rest of
 * enforce()'s checks, see that file's comment for why). This one is
 * narrower and purpose-built for the daily-ops-summary schedule: a fixed
 * recent window (default 24h) plus the count of approvals still sitting
 * pending, since "what's still waiting on a human" is as much a part of
 * an honest ops digest as what already ran.
 */
export default defineTool({
  description:
    "Summarize this organization's agent activity over the past N hours (default 24) — a tool-call breakdown by event type plus the count of approval requests still pending. Use this for a daily/periodic ops digest.",
  inputSchema: z.object({
    hours: z.number().int().min(1).max(168).default(24),
  }),
  async execute({ hours }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "ops-manager" }, dbDeps);

    const windowStart = new Date(Date.now() - hours * 60 * 60_000);

    const breakdown = await db
      .select({
        eventType: activityLog.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.orgId, orgId), gte(activityLog.timestamp, windowStart)))
      .groupBy(activityLog.eventType);

    const [{ pendingApprovals }] = await db
      .select({ pendingApprovals: sql<number>`count(*)::int` })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.status, "pending")));

    return { hours, breakdown, pendingApprovals };
  },
});
