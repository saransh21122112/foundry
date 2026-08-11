import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db, departmentConfigs, ensureOrganization } from "@foundry/db";
import { AUTONOMY_LEVELS, DEPARTMENTS, type AutonomyLevel } from "@foundry/shared-types";
import { AUTONOMY_DESCRIPTION, AUTONOMY_LABEL, DEPARTMENT_BLURB } from "@/lib/copy";
import { submitOnboarding } from "./actions";

const SCOPES = [
  { value: "per_run", label: "Per single action" },
  { value: "daily", label: "Per day" },
  { value: "monthly", label: "Per month" },
] as const;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const { done } = await searchParams;
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Get set up</h1>
        <p className="lede">Sign in and select or create an organization to get started.</p>
      </main>
    );
  }

  if (done === "1") {
    return (
      <main>
        <p className="eyebrow">Setup complete</p>
        <h1>You&apos;re set up</h1>
        <p className="lede">
          Your departments and budget are configured. Fine-tune anything
          later from Departments or Budgets in the sidebar.
        </p>
        <Link href="/dashboard/tasks" className="btn btn-primary">
          Go run your first task
        </Link>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const rows = await db.select({ id: departmentConfigs.id }).from(departmentConfigs).where(eq(departmentConfigs.orgId, org.id));

  // A configured org has already been through this flow (or the
  // Departments page directly) — send it straight to task delegation
  // instead of re-showing first-run setup.
  if (rows.length > 0) {
    redirect("/dashboard/tasks");
  }

  return (
    <main>
      <p className="eyebrow">First run</p>
      <h1>Get set up</h1>
      <p className="lede">
        Three quick choices and your company can do real work. You can
        change any of this later from Departments or Budgets.
      </p>

      <form action={submitOnboarding}>
        <p className="eyebrow" style={{ marginTop: 32 }}>What does your company do?</p>
        <p className="lede" style={{ marginTop: 0 }}>
          Optional, but it grounds every agent&apos;s instructions in your real business instead of generic boilerplate.
        </p>
        <div className="panel">
          <div className="field-row">
            <label>
              Description
              <textarea name="description" rows={3} placeholder="A short description of what your company does" />
            </label>
            <label>
              Website
              <input type="url" name="website" placeholder="https://example.com" />
            </label>
          </div>
        </div>

        <p className="eyebrow" style={{ marginTop: 32 }}>1. Turn on the departments you want</p>
        <div className="panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {DEPARTMENTS.map((department) => (
              <label
                key={department}
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
                <input type="checkbox" name="department" value={department} style={{ marginTop: 3 }} />
                <span>
                  <strong className="mono" style={{ textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {department}
                  </strong>
                  <br />
                  <span style={{ color: "var(--iron)" }}>{DEPARTMENT_BLURB[department]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <p className="eyebrow" style={{ marginTop: 32 }}>2. How much can they do on their own?</p>
        <p className="lede" style={{ marginTop: 0 }}>Applied to every department you turned on above.</p>
        <div className="panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                <input type="radio" name="autonomyLevel" value={l} defaultChecked={l === "draft_only"} style={{ marginTop: 3 }} />
                <span>
                  <strong>{AUTONOMY_LABEL[l]}</strong>
                  <br />
                  <span style={{ color: "var(--iron)" }}>{AUTONOMY_DESCRIPTION[l]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <p className="eyebrow" style={{ marginTop: 32 }}>3. Set a starter budget cap (optional)</p>
        <div className="panel">
          <div className="field-row">
            <label>
              Department
              <select name="budgetDepartment" defaultValue="">
                <option value="" disabled>Choose one</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Resets
              <select name="budgetScope" defaultValue="monthly">
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit
              <input type="text" name="budgetUnit" placeholder="usd, emails_sent" />
              <span className="mono" style={{ fontSize: 11, color: "var(--iron-dim)", textTransform: "none" }}>
                Whatever a tool reports spending — usually usd or a count like emails_sent.
              </span>
            </label>
            <label>
              Cap amount
              <input type="number" name="budgetCapAmount" min="0" step="any" />
            </label>
          </div>
          <p style={{ color: "var(--iron)", fontSize: 12, margin: "8px 0 0" }}>
            Leave the cap amount blank to skip this — every department stays uncapped until you set one, here or on the Budgets page.
          </p>
        </div>

        <button type="submit" className="btn btn-primary" style={{ marginTop: 24 }}>
          Finish setup
        </button>
      </form>
    </main>
  );
}
