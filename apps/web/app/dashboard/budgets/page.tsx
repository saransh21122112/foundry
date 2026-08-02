import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { budgetCaps, db, ensureOrganization } from "@foundry/db";
import { DEPARTMENTS } from "@foundry/shared-types";
import { resetBudgetSpend, updateBudgetCap } from "./actions";

const SCOPES = [
  { value: "per_run", label: "Per single action" },
  { value: "daily", label: "Per day" },
  { value: "monthly", label: "Per month" },
] as const;

export default async function BudgetsPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Budgets</h1>
        <p className="lede">Sign in and select or create an organization to configure budget caps.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const caps = await db.select().from(budgetCaps).where(eq(budgetCaps.orgId, org.id));

  return (
    <main>
      <p className="eyebrow">Spend ceilings</p>
      <h1>Budget caps</h1>
      <p className="lede">
        A department stopped and asked before doing anything that would
        cross a cap you&apos;ve set here — it never spends past it on its
        own, even at &ldquo;Fully autonomous.&rdquo; Daily and monthly caps
        reset themselves once their period elapses; use &ldquo;Reset
        spend&rdquo; below to zero one out early.
      </p>

      <div className="panel">
        {caps.length === 0 && <p className="panel-empty">None set — every department is currently uncapped.</p>}
        {caps.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Resets</th>
                <th>Unit</th>
                <th>Spend / cap</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {caps.map((cap) => {
                const spend = Number(cap.currentSpend);
                const capAmount = Number(cap.capAmount);
                const pct = capAmount > 0 ? Math.min(100, (spend / capAmount) * 100) : 0;
                const scopeLabel = SCOPES.find((s) => s.value === cap.scope)?.label ?? cap.scope;
                return (
                  <tr key={cap.id}>
                    <td className="mono">{cap.department ?? "All departments"}</td>
                    <td>{scopeLabel}</td>
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
                    <td>
                      <form action={resetBudgetSpend}>
                        <input type="hidden" name="budgetCapId" value={cap.id} />
                        <button type="submit" className="btn">
                          Reset spend
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Set a cap</p>
      <div className="panel">
        <form action={updateBudgetCap} className="field-row">
          <label>
            Department
            <select name="department" required defaultValue="org-wide">
              <option value="org-wide">All departments (org-wide)</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resets
            <select name="scope" required>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <input type="text" name="unit" placeholder="usd, emails_sent" required />
            <span className="mono" style={{ fontSize: 11, color: "var(--iron-dim)", textTransform: "none" }}>
              Whatever a tool reports spending — usually usd or a count like emails_sent.
            </span>
          </label>
          <label>
            Cap amount
            <input type="number" name="capAmount" min="0" step="any" required />
          </label>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </form>
      </div>
    </main>
  );
}
