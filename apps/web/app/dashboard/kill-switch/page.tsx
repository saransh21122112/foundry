import { desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, killSwitches } from "@foundry/db";
import { DEPARTMENTS } from "@foundry/shared-types";
import { DEPARTMENT_BLURB } from "@/lib/copy";
import { resolveKillSwitch, triggerKillSwitch } from "./actions";

const KILL_EVERYTHING_CONFIRM = "KILL EVERYTHING";

export default async function KillSwitchPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Kill switch</h1>
        <p className="lede">Sign in and select or create an organization to use the kill switch.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const rows = await db
    .select()
    .from(killSwitches)
    .where(eq(killSwitches.orgId, org.id))
    .orderBy(desc(killSwitches.triggeredAt));

  const active = rows.filter((r) => r.active);
  const orgWideActive = active.find((r) => r.department === null);
  const activeByDept = new Map(active.filter((r) => r.department !== null).map((r) => [r.department, r]));

  return (
    <main>
      <p className="eyebrow">Emergency stop</p>
      <h1>Kill switch</h1>
      <p className="lede">
        Blocks every tool call for the org (or one department) immediately,
        no matter what autonomy level is set. This is the first thing
        guardrails checks on every action. Nothing here is subtle — every
        trigger and resolve is logged to Activity.
      </p>

      <p className="eyebrow" style={{ marginTop: 32 }}>Active now</p>
      <div className="panel">
        {active.length === 0 && <p className="panel-empty">Nothing is killed. Every enabled department can act normally.</p>}
        {active.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Reason</th>
                <th>Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <tr key={row.id}>
                  <td className="mono" style={{ color: row.department === null ? "var(--ember-hot)" : "var(--paper)" }}>
                    {row.department ?? "Whole org"}
                  </td>
                  <td>{row.reason ?? "—"}</td>
                  <td className="mono" style={{ color: "var(--iron)" }}>{row.triggeredAt.toLocaleString()}</td>
                  <td>
                    <form action={resolveKillSwitch}>
                      <input type="hidden" name="killSwitchId" value={row.id} />
                      <button type="submit" className="btn btn-primary">
                        Resolve
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Kill everything</p>
      <div className="panel" style={{ borderColor: "var(--ember-hot)" }}>
        {orgWideActive ? (
          <p className="panel-empty">
            The whole org is already killed (since {orgWideActive.triggeredAt.toLocaleString()}). Resolve it above to
            restore normal operation.
          </p>
        ) : (
          <form action={triggerKillSwitch} className="field-row">
            <input type="hidden" name="department" value="" />
            <label>
              Reason (optional, but shows up in Activity)
              <input type="text" name="reason" placeholder="e.g. runaway spend, bad output" />
            </label>
            <label>
              Type &ldquo;{KILL_EVERYTHING_CONFIRM}&rdquo; to confirm
              <input
                type="text"
                name="confirm"
                required
                pattern={KILL_EVERYTHING_CONFIRM}
                placeholder={KILL_EVERYTHING_CONFIRM}
                autoComplete="off"
              />
            </label>
            <button
              type="submit"
              className="btn"
              style={{ borderColor: "var(--ember-hot)", color: "var(--ember-hot)" }}
            >
              Kill everything, right now
            </button>
          </form>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Kill one department</p>
      {DEPARTMENTS.map((department) => {
        const activeRow = activeByDept.get(department);
        return (
          <div className="panel" key={department}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 className="mono" style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 4px" }}>
                  {department}
                </h2>
                <p style={{ color: "var(--iron)", fontSize: 13, margin: 0 }}>{DEPARTMENT_BLURB[department]}</p>
              </div>
            </div>
            {activeRow ? (
              <form action={resolveKillSwitch}>
                <input type="hidden" name="killSwitchId" value={activeRow.id} />
                <button type="submit" className="btn btn-primary">
                  Resolve — let {department} act again
                </button>
              </form>
            ) : (
              <form action={triggerKillSwitch} className="field-row">
                <input type="hidden" name="department" value={department} />
                <label>
                  Reason (optional)
                  <input type="text" name="reason" placeholder="e.g. pause while I check its last output" />
                </label>
                <button type="submit" className="btn" style={{ borderColor: "var(--ember-hot)", color: "var(--ember-hot)" }}>
                  Kill {department}
                </button>
              </form>
            )}
          </div>
        );
      })}
    </main>
  );
}
