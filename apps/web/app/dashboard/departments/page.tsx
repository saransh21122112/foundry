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

  // Independent queries — no reason to make the page wait on them one at a
  // time (was a real, measurable chunk of this page's load time: each is
  // its own DB round-trip).
  const [rows, [orgRow]] = await Promise.all([
    db.select().from(departmentConfigs).where(eq(departmentConfigs.orgId, org.id)),
    db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, org.id)).limit(1),
  ]);
  const configByDept = new Map(rows.map((r) => [r.department, r]));
  const plan = orgRow?.plan ?? "free";

  // Only draft_only + enabled departments can even be promoted (the only
  // real path is draft_only -> bounded_autonomous). Each call is 2 DB
  // queries (lib/autonomy-suggestion.ts) — run them in parallel rather
  // than serialized one department at a time.
  const eligibleDepartments = DEPARTMENTS.filter((department) => {
    const config = configByDept.get(department);
    return (config?.enabled ?? false) && (config?.autonomyLevel ?? "draft_only") === "draft_only";
  });
  const suggestionResults = await Promise.all(
    eligibleDepartments.map((department) => computeAutonomySuggestion(org.id, department)),
  );
  const suggestions = new Map(eligibleDepartments.map((department, i) => [department, suggestionResults[i]]));

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
          <section className="settings-section" key={department}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <h2 className="settings-section__heading" style={{ marginBottom: 2 }}>
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

            <DepartmentForm>
              <input type="hidden" name="department" value={department} />
              <div className="settings-group">
                <div className="settings-row">
                  <div>
                    <p className="settings-row__title">Turn this department on</p>
                    <p className="settings-row__description">Off by default — nothing happens until this is on.</p>
                  </div>
                  <label className="settings-row__control" style={{ flexDirection: "row" }}>
                    <input type="checkbox" name="enabled" defaultChecked={enabled} aria-label="Turn this department on" />
                  </label>
                </div>
                <div className="settings-row settings-row--stacked" id={radioGroupId}>
                  <p className="settings-row__title" style={{ marginBottom: 4 }}>
                    How much can it do on its own?
                  </p>
                  <div>
                    {AUTONOMY_LEVELS.map((l: AutonomyLevel) => (
                      <label key={l} className="settings-option">
                        <input type="radio" name="autonomyLevel" value={l} defaultChecked={level === l} />
                        <span>
                          <span className="settings-option__label">{AUTONOMY_LABEL[l]}</span>
                          <span className="settings-option__description">{AUTONOMY_DESCRIPTION[l]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </DepartmentForm>
          </section>
        );
      })}
    </main>
  );
}
