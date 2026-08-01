import { desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { activityLog, db, ensureOrganization } from "@foundry/db";
import { EVENT_TYPE_LABEL } from "@/lib/copy";
import { AutoRefresh } from "@/components/AutoRefresh";

const EVENT_COLOR: Record<string, string> = {
  tool_call_executed: "var(--cool)",
  tool_call_allowed: "var(--ember)",
  tool_call_blocked: "var(--ember-hot)",
  tool_call_failed: "var(--ember-hot)",
  tool_call_attempted: "var(--iron)",
  approval_granted: "var(--cool)",
  approval_rejected: "var(--ember-hot)",
  kill_switch_triggered: "var(--ember-hot)",
};

export default async function ActivityPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Activity</h1>
        <p className="lede">Sign in and select or create an organization to see its activity log.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const rows = await db
    .select({
      id: activityLog.id,
      department: activityLog.department,
      eventType: activityLog.eventType,
      toolName: activityLog.toolName,
      actor: activityLog.actor,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(eq(activityLog.orgId, org.id))
    .orderBy(desc(activityLog.timestamp))
    .limit(200);

  return (
    <main>
      <AutoRefresh />
      <p className="eyebrow">Full record, unedited</p>
      <h1>Activity</h1>
      <p className="lede">
        Everything every department has tried to do, in order — whether it
        ran on its own, waited for you, or was turned off outright.
      </p>

      <div className="panel">
        {rows.length === 0 && <p className="panel-empty">No activity yet.</p>}
        {rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Department</th>
                <th>Event</th>
                <th>Tool</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono" style={{ color: "var(--iron)" }}>
                    {row.timestamp.toLocaleString()}
                  </td>
                  <td className="mono">{row.department}</td>
                  <td>
                    <span
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, color: EVENT_COLOR[row.eventType] ?? "var(--iron)" }}
                      title={row.eventType}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: EVENT_COLOR[row.eventType] ?? "var(--iron)",
                          flexShrink: 0,
                        }}
                      />
                      {EVENT_TYPE_LABEL[row.eventType] ?? row.eventType}
                    </span>
                  </td>
                  <td className="mono">{row.toolName ?? "—"}</td>
                  <td className="mono" style={{ color: "var(--iron)" }}>{row.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
