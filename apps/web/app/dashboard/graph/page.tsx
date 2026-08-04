import { and, desc, eq, isNotNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { activityLog, approvalRequests, db, departmentConfigs, ensureOrganization } from "@foundry/db";
import type { Department } from "@foundry/shared-types";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GraphView, type GraphDeptNode } from "./GraphView";

export default async function GraphPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Live activity</h1>
        <p className="lede">Sign in and select or create an organization to see who&apos;s working on what.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  // Nodes are this org's actually-enabled departments (department_configs),
  // never a hardcoded roster — a fresh org with nothing turned on sees an
  // empty state below instead of 7 dead-looking nodes.
  const enabledDepts = await db
    .select({ department: departmentConfigs.department, autonomyLevel: departmentConfigs.autonomyLevel })
    .from(departmentConfigs)
    .where(and(eq(departmentConfigs.orgId, org.id), eq(departmentConfigs.enabled, true)));

  if (enabledDepts.length === 0) {
    return (
      <main>
        <p className="eyebrow">Who&apos;s working on what</p>
        <h1>Live activity</h1>
        <p className="lede">
          No departments are turned on yet. <a href="/dashboard/departments">Turn one on</a> to see it here.
        </p>
      </main>
    );
  }

  // Same row cap the Activity page already uses (activity_log has an
  // (org_id, timestamp) index) — bounded, not a full table scan, and
  // ordered desc so slicing per department below is trivial.
  const recentRows = await db
    .select({
      id: activityLog.id,
      department: activityLog.department,
      eventType: activityLog.eventType,
      toolName: activityLog.toolName,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(and(eq(activityLog.orgId, org.id), isNotNull(activityLog.department)))
    .orderBy(desc(activityLog.timestamp))
    .limit(200);

  // "Needs attention" reuses the same signal the Approvals page already
  // treats as authoritative — a pending row here, not an inferred event type.
  const pendingRows = await db
    .select({ department: approvalRequests.department })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, org.id), eq(approvalRequests.status, "pending")));

  const pendingByDept = new Map<string, number>();
  pendingRows.forEach((r) => pendingByDept.set(r.department, (pendingByDept.get(r.department) ?? 0) + 1));

  const nodes: GraphDeptNode[] = enabledDepts.map(({ department, autonomyLevel }) => {
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

  return (
    <main>
      <AutoRefresh intervalMs={4000} />
      <p className="eyebrow">Who&apos;s working on what</p>
      <h1>Live activity</h1>
      <p className="lede">
        Every department you&apos;ve turned on, live — a moving current means it logged something in the last two
        minutes, a red ring means it&apos;s waiting on you.
      </p>
      <GraphView nodes={nodes} orgLabel={orgSlug ?? "Your org"} />
    </main>
  );
}
