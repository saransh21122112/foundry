import { and, desc, eq, ne } from "drizzle-orm";
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
  kill_switch_resolved: "var(--ember)",
};

// The only failure event actually persisted to activity_log today —
// activityEventTypeEnum (packages/db/src/schema.ts) has no turn_failed /
// session_failed variant. Those only ever exist as transient stream events
// (see RunBoard.tsx's step.failed/turn.failed/session.failed handling) and
// are never written as a row here — logging them is out of scope for this
// change, noted as a finding rather than added.
const FAILED_EVENT_TYPE = "tool_call_failed";

function errorMessageFrom(toolOutput: unknown): string | null {
  if (toolOutput && typeof toolOutput === "object" && "error" in toolOutput) {
    const err = (toolOutput as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  return toolOutput ? JSON.stringify(toolOutput) : null;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  const { filter } = await searchParams;
  const failedOnly = filter === "failed";

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
      agentNodeId: activityLog.agentNodeId,
      eventType: activityLog.eventType,
      toolName: activityLog.toolName,
      toolOutput: activityLog.toolOutput,
      actor: activityLog.actor,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(
      // subagent_delegated is deliberately excluded — plain agent-to-agent
      // delegation, not a guardrails-relevant action. It shows on
      // /dashboard/graph instead (see log-tool-result.ts's
      // logSubagentDelegation). This page stays a record of actual
      // attempted/gated/executed actions only.
      failedOnly
        ? and(eq(activityLog.orgId, org.id), eq(activityLog.eventType, FAILED_EVENT_TYPE))
        : and(eq(activityLog.orgId, org.id), ne(activityLog.eventType, "subagent_delegated")),
    )
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

      <p style={{ marginBottom: 16 }}>
        <a href="/dashboard/activity" className={failedOnly ? "btn" : "btn btn-primary"}>
          All activity
        </a>{" "}
        <a href="/dashboard/activity?filter=failed" className={failedOnly ? "btn btn-reject" : "btn"}>
          Failures only
        </a>
      </p>

      <div className="panel">
        {rows.length === 0 && (
          <p className="panel-empty">{failedOnly ? "No failures — everything's run clean." : "No activity yet."}</p>
        )}
        {rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Department</th>
                <th>Event</th>
                <th>Tool</th>
                <th>Actor</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isFailed = row.eventType === FAILED_EVENT_TYPE;
                const errorMessage = isFailed ? errorMessageFrom(row.toolOutput) : null;
                return (
                  <tr key={row.id} className={isFailed ? "row-failed" : undefined}>
                    <td className="mono" style={{ color: "var(--iron)" }}>
                      {row.timestamp.toLocaleString()}
                    </td>
                    <td className="mono">
                      {row.department ?? "All departments"}
                      {row.agentNodeId && row.agentNodeId !== row.department && (
                        <span style={{ color: "var(--iron)" }}> / {row.agentNodeId.split("/").pop()}</span>
                      )}
                    </td>
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
                    <td>
                      {errorMessage ? (
                        <details>
                          <summary className="mono" style={{ color: "var(--ember-hot)", cursor: "pointer" }}>
                            {errorMessage.length > 60 ? `${errorMessage.slice(0, 60)}…` : errorMessage}
                          </summary>
                          {errorMessage.length > 60 && <p style={{ marginTop: 6 }}>{errorMessage}</p>}
                        </details>
                      ) : (
                        "—"
                      )}
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
