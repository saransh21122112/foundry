import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, departmentConfigs, ensureOrganization, organizations } from "@foundry/db";
import { AUTONOMY_LEVELS, DEPARTMENTS, type AutonomyLevel } from "@foundry/shared-types";
import { AutonomyGauge } from "@/components/AutonomyGauge";
import { AUTONOMY_DESCRIPTION, AUTONOMY_LABEL, AUTONOMY_SUGGESTION, DEPARTMENT_BLURB } from "@/lib/copy";
import { computeAutonomySuggestion } from "@/lib/autonomy-suggestion";
import { DepartmentForm } from "./DepartmentForm";
import { dismissAutonomySuggestion } from "./actions";

export default async function DepartmentsPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Departments</h1>
        <p className="lede">Sign in and select or create an organization to configure departments.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const rows = await db.select().from(departmentConfigs).where(eq(departmentConfigs.orgId, org.id));
  const configByDept = new Map(rows.map((r) => [r.department, r]));

  const [orgRow] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  const plan = orgRow?.plan ?? "free";

  // Only draft_only + enabled departments can even be promoted (the only
  // real path is draft_only -> bounded_autonomous) — cheap enough to compute
  // per-row, no batching needed at this scale.
  const suggestions = new Map<string, Awaited<ReturnType<typeof computeAutonomySuggestion>>>();
  for (const department of DEPARTMENTS) {
    const config = configByDept.get(department);
    if ((config?.enabled ?? false) && (config?.autonomyLevel ?? "draft_only") === "draft_only") {
      suggestions.set(department, await computeAutonomySuggestion(org.id, department));
    }
  }

  return (
    <main>
      <p className="eyebrow">Heat allowed, per department</p>
      <h1>Departments</h1>
      <p className="lede">
        Every new department starts turned off. Turn one on, then choose how
        much it&apos;s allowed to do without asking you first — you can
        change either any time.
      </p>

      {DEPARTMENTS.map((department) => {
        const config = configByDept.get(department);
        const level = config?.autonomyLevel ?? "draft_only";
        const enabled = config?.enabled ?? false;
        const suggestion = suggestions.get(department);
        const showSuggestion = !!suggestion && suggestion.eligible && !suggestion.dismissed;
        const radioGroupId = `autonomy-radios-${department}`;
        return (
          <div className="panel" key={department}>
            <DepartmentForm>
              <input type="hidden" name="department" value={department} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <h2 className="mono" style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: "0.03em", margin: "0 0 4px" }}>
                    {department}
                  </h2>
                  <p style={{ color: "var(--iron)", fontSize: 13, margin: 0 }}>{DEPARTMENT_BLURB[department]}</p>
                </div>
                <AutonomyGauge level={enabled ? level : "off"} />
              </div>

              {showSuggestion && (
                <div className="callout">
                  <p style={{ margin: "0 0 10px", fontSize: 13 }}>
                    {plan === "free" ? AUTONOMY_SUGGESTION.eligibleFreePlan : AUTONOMY_SUGGESTION.eligible}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {plan === "free" ? (
                      <a href="/dashboard/billing" className="btn">
                        Upgrade to Pro
                      </a>
                    ) : (
                      <a href={`#${radioGroupId}`} className="btn">
                        Review below
                      </a>
                    )}
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await dismissAutonomySuggestion(formData);
                      }}
                    >
                      <input type="hidden" name="department" value={department} />
                      <button type="submit" className="btn">
                        {AUTONOMY_SUGGESTION.dismiss}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              <label
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                  paddingBottom: 16,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <input type="checkbox" name="enabled" defaultChecked={enabled} />
                Turn this department on
              </label>

              <p className="eyebrow" style={{ margin: "0 0 8px" }}>How much can it do on its own?</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {AUTONOMY_LEVELS.map((l: AutonomyLevel) => (
                  <label
                    key={l}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 10,
                      textTransform: "none",
                      fontFamily: "var(--font-body)",
                      fontSize: 13,
                      color: "var(--paper)",
                      cursor: "pointer",
                    }}
                  >
                    <input type="radio" name="autonomyLevel" value={l} defaultChecked={level === l} style={{ marginTop: 3 }} />
                    <span>
                      <strong>{AUTONOMY_LABEL[l]}</strong>
                      <br />
                      <span style={{ color: "var(--iron)" }}>{AUTONOMY_DESCRIPTION[l]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </DepartmentForm>
          </div>
        );
      })}
    </main>
  );
}
