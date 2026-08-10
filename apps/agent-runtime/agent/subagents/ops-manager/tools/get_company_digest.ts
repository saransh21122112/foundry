import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, activityLog, approvalRequests } from "@foundry/db";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Org-wide sibling of get_daily_ops_digest.ts — that tool is scoped to
 * ops-manager's own department, which is right for a per-department digest
 * but wrong for a company-wide "chief of staff" briefing (see
 * agent/schedules/chief-of-staff-briefing.ts): this one has no department
 * filter, and breaks the tool-call breakdown down per department so a
 * cross-department briefing can actually say which department did what.
 */
export default defineTool({
  description:
    "Summarize this organization's agent activity across every department over the past N hours (default 24) — a tool-call breakdown by department and event type, plus the count of approval requests still pending. Use this for a company-wide (not single-department) digest.",
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
        department: activityLog.department,
        eventType: activityLog.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.orgId, orgId), gte(activityLog.timestamp, windowStart)))
      .groupBy(activityLog.department, activityLog.eventType);

    const pendingByDepartment = await db
      .select({
        department: approvalRequests.department,
        count: sql<number>`count(*)::int`,
      })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.status, "pending")))
      .groupBy(approvalRequests.department);

    return { hours, breakdown, pendingByDepartment };
  },
});
