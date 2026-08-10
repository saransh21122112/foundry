import { and, eq, gte, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { activityLog, approvalRequests, budgetCaps, db, ensureOrganization } from "@foundry/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EVENT_TYPE_LABEL } from "@/lib/copy";

/**
 * The reel this session's feature work drew from showed an ambient KPI wall
 * display (revenue, leads, ad spend). Foundry's own equivalent real data is
 * its guardrails/activity data, not a generic business's — tool-call volume,
 * pending approvals, budget spend vs caps. Same query shapes already used
 * elsewhere: the 24h department+eventType breakdown mirrors
 * get_activity_summary.ts / get_company_digest.ts, the pending-approvals
 * count mirrors get_company_digest.ts, and the budget rows are the same
 * table budgets/page.tsx already reads (just rendered read-only here).
 */
export default async function KpisPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Live metrics</h1>
        <p className="lede">Sign in and select or create an organization to see its metrics.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const windowStart = new Date(Date.now() - 24 * 60 * 60_000);

  const breakdown = await db
    .select({
      department: activityLog.department,
      eventType: activityLog.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(activityLog)
    .where(and(eq(activityLog.orgId, org.id), gte(activityLog.timestamp, windowStart)))
    .groupBy(activityLog.department, activityLog.eventType);

  const pendingByDept = await db
    .select({ department: approvalRequests.department, count: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, org.id), eq(approvalRequests.status, "pending")))
    .groupBy(approvalRequests.department);

  const caps = await db.select().from(budgetCaps).where(eq(budgetCaps.orgId, org.id));

  const totalCalls = breakdown.reduce((sum, r) => sum + r.count, 0);
  const totalPending = pendingByDept.reduce((sum, r) => sum + r.count, 0);
  const executed = breakdown
    .filter((r) => r.eventType === "tool_call_executed")
    .reduce((sum, r) => sum + r.count, 0);
  const failed = breakdown.filter((r) => r.eventType === "tool_call_failed").reduce((sum, r) => sum + r.count, 0);

  const byDept = new Map<string, { department: string; count: number }[]>();
  breakdown.forEach((r) => {
    const dept = r.department ?? "All departments";
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push({ department: EVENT_TYPE_LABEL[r.eventType] ?? r.eventType, count: r.count });
  });

  return (
    <main>
      <AutoRefresh intervalMs={5000} />
      <p className="eyebrow">Last 24 hours, live</p>
      <h1>Live metrics</h1>
      <p className="lede">Your company&apos;s own guardrails data, refreshing on its own — not a generic dashboard.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 16 }}>
        <div className="panel">
          <p className="eyebrow" style={{ margin: "0 0 4px" }}>Tool calls</p>
          <p className="mono" style={{ fontSize: 28, margin: 0 }}>{totalCalls}</p>
        </div>
        <div className="panel">
          <p className="eyebrow" style={{ margin: "0 0 4px" }}>Executed</p>
          <p className="mono" style={{ fontSize: 28, margin: 0 }}>{executed}</p>
        </div>
        <div className="panel" style={{ borderColor: failed > 0 ? "var(--ember-hot)" : undefined }}>
          <p className="eyebrow" style={{ margin: "0 0 4px" }}>Failed</p>
          <p className="mono" style={{ fontSize: 28, margin: 0, color: failed > 0 ? "var(--ember-hot)" : undefined }}>
            {failed}
          </p>
        </div>
        <div className="panel" style={{ borderColor: totalPending > 0 ? "var(--ember-hot)" : undefined }}>
          <p className="eyebrow" style={{ margin: "0 0 4px" }}>Pending approvals</p>
          <p className="mono" style={{ fontSize: 28, margin: 0, color: totalPending > 0 ? "var(--ember-hot)" : undefined }}>
            {totalPending}
          </p>
        </div>
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>By department</p>
      <div className="panel">
        {byDept.size === 0 && <p className="panel-empty">No activity in the last 24 hours.</p>}
        {byDept.size > 0 && (
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(byDept.entries()).map(([dept, rows]) => (
                <tr key={dept}>
                  <td className="mono">{dept}</td>
                  <td className="mono" style={{ color: "var(--iron)" }}>
                    {rows.map((r) => `${r.department}: ${r.count}`).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Budget spend</p>
      <div className="panel">
        {caps.length === 0 && <p className="panel-empty">No caps set — see <a href="/dashboard/budgets">Budgets</a>.</p>}
        {caps.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Unit</th>
                <th>Spend / cap</th>
              </tr>
            </thead>
            <tbody>
              {caps.map((cap) => {
                const spend = Number(cap.currentSpend);
                const capAmount = Number(cap.capAmount);
                const pct = capAmount > 0 ? Math.min(100, (spend / capAmount) * 100) : 0;
                return (
                  <tr key={cap.id}>
                    <td className="mono">{cap.department ?? "All departments"}</td>
                    <td className="mono">{cap.unit}</td>
                    <td style={{ minWidth: 160 }}>
                      <div className="mono" style={{ fontSize: 12, marginBottom: 4 }}>
                        {cap.currentSpend} / {cap.capAmount}
                      </div>
                      <div style={{ height: 4, background: "var(--line)", borderRadius: 2 }}>
                        <div
                          style={{
                            height: 4,
                            width: `${pct}%`,
                            borderRadius: 2,
                            background: pct > 80 ? "var(--ember-hot)" : "var(--ember)",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
