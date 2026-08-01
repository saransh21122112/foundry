import { and, desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { approvalRequests, db, ensureOrganization } from "@foundry/db";
import { approvalReasonLabel } from "@/lib/copy";
import { resolveApproval } from "./actions";

/**
 * The highest-priority screen in the whole product per ROADMAP.md Phase 3 —
 * this is what makes headless autonomy trustworthy to a solo founder: every
 * blocked/parked tool call shows up here for a yes/no decision. Approve/
 * reject really resumes the parked eve session now (see ./actions.ts and
 * lib/eve-client.ts), verified live 2026-08-01.
 */
export default async function ApprovalsPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Approval queue</h1>
        <p className="lede">Sign in and select or create an organization to see its approval queue.</p>
      </main>
    );
  }

  let pending: Array<{
    id: string;
    department: string;
    toolName: string;
    reason: string;
    requestedAt: Date;
  }> = [];
  let error: string | null = null;

  try {
    const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
    pending = await db
      .select({
        id: approvalRequests.id,
        department: approvalRequests.department,
        toolName: approvalRequests.toolName,
        reason: approvalRequests.reason,
        requestedAt: approvalRequests.requestedAt,
      })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, org.id), eq(approvalRequests.status, "pending")))
      .orderBy(desc(approvalRequests.requestedAt))
      .limit(50);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main>
      <p className="eyebrow">Waiting on you</p>
      <h1>Approval queue</h1>
      <p className="lede">
        Every action a department wanted to take, but stopped to ask first.
        Nothing here happens until you approve or reject it.
      </p>

      {error && (
        <div className="panel">
          <p style={{ color: "var(--ember-hot)" }}>Database error: {error}</p>
        </div>
      )}
      {!error && pending.length === 0 && (
        <div className="panel">
          <p className="panel-empty">Nothing waiting on you right now.</p>
        </div>
      )}
      {!error &&
        pending.map((row) => (
          <div className="panel" key={row.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div>
                <p style={{ margin: "0 0 4px" }}>
                  <span className="mono" style={{ textTransform: "uppercase", fontSize: 13, color: "var(--ember)" }}>
                    {row.department}
                  </span>{" "}
                  wants to run <code>{row.toolName}</code>
                </p>
                <p style={{ margin: "0 0 4px", color: "var(--paper)" }}>{approvalReasonLabel(row.reason)}</p>
                <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--iron)" }}>
                  Requested {row.requestedAt.toLocaleString()}
                </p>
              </div>
              <form action={resolveApproval} style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <input type="hidden" name="approvalId" value={row.id} />
                <button type="submit" name="decision" value="approved" className="btn btn-approve">
                  Approve
                </button>
                <button type="submit" name="decision" value="rejected" className="btn btn-reject">
                  Reject
                </button>
              </form>
            </div>
          </div>
        ))}
    </main>
  );
}
