import { and, desc, eq, isNotNull } from "drizzle-orm";
import { activityLog, approvalRequests, db, departmentConfigs } from "@foundry/db";
import type { Department } from "@foundry/shared-types";
import type { GraphDeptNode } from "@/app/dashboard/graph/GraphView";

/**
 * Extracted from dashboard/graph/page.tsx so the signed-in homepage
 * (app/page.tsx) can render the exact same live graph without duplicating
 * the query — same enabled-departments/recent-activity/pending-approvals
 * shape, reused as-is by both pages.
 */
export async function loadGraphNodes(orgId: string): Promise<GraphDeptNode[]> {
  const enabledDepts = await db
    .select({ department: departmentConfigs.department, autonomyLevel: departmentConfigs.autonomyLevel })
    .from(departmentConfigs)
    .where(and(eq(departmentConfigs.orgId, orgId), eq(departmentConfigs.enabled, true)));

  if (enabledDepts.length === 0) return [];

  const recentRows = await db
    .select({
      id: activityLog.id,
      department: activityLog.department,
      eventType: activityLog.eventType,
      toolName: activityLog.toolName,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(and(eq(activityLog.orgId, orgId), isNotNull(activityLog.department)))
    .orderBy(desc(activityLog.timestamp))
    .limit(200);

  const pendingRows = await db
    .select({ department: approvalRequests.department })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.status, "pending")));

  const pendingByDept = new Map<string, number>();
  pendingRows.forEach((r) => pendingByDept.set(r.department, (pendingByDept.get(r.department) ?? 0) + 1));

  return enabledDepts.map(({ department, autonomyLevel }) => {
    const rows = recentRows.filter((r) => r.department === department);
    return {
      id: department as Department,
      autonomyLevel,
      lastEventAtMs: rows[0]?.timestamp.getTime() ?? null,
      pendingApprovals: pendingByDept.get(department) ?? 0,
      recent: rows.slice(0, 8).map((r) => ({
        id: r.id,
        eventType: r.eventType,
        toolName: r.toolName,
        timestampMs: r.timestamp.getTime(),
      })),
    };
  });
}
