"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { budgetCaps, db, ensureOrganization } from "@foundry/db";
import { DEPARTMENTS, type Department } from "@foundry/shared-types";
import { requireOrgAdmin } from "@/lib/authz";

const SCOPES = ["per_run", "daily", "monthly"] as const;

/**
 * Upserts a budget_caps row (department + scope + unit is the natural
 * key — see the schema's unique index). Admin-only. Setting a cap here is
 * what `packages/guardrails`' `checkAndReserveBudget` actually reads —
 * this is a real safety control, not a cosmetic dashboard field.
 */
export async function updateBudgetCap(formData: FormData) {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();

  const departmentRaw = formData.get("department");
  const scope = formData.get("scope");
  const unit = formData.get("unit");
  const capAmount = formData.get("capAmount");

  // Empty string / "org-wide" (the <select>'s "All departments" option) means
  // a whole-org cap — same null-is-org-wide convention as kill_switches.
  const isOrgWide = departmentRaw === "" || departmentRaw === "org-wide";

  if (
    typeof departmentRaw !== "string" ||
    (!isOrgWide && !DEPARTMENTS.includes(departmentRaw as Department)) ||
    typeof scope !== "string" ||
    !SCOPES.includes(scope as (typeof SCOPES)[number]) ||
    typeof unit !== "string" ||
    unit.trim().length === 0 ||
    typeof capAmount !== "string" ||
    Number.isNaN(Number(capAmount)) ||
    Number(capAmount) < 0
  ) {
    throw new Error("Invalid form submission.");
  }
  const department = isOrgWide ? null : (departmentRaw as Department);

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const existing = await db
    .select({ id: budgetCaps.id })
    .from(budgetCaps)
    .where(
      and(
        eq(budgetCaps.orgId, org.id),
        department === null ? isNull(budgetCaps.department) : eq(budgetCaps.department, department),
        eq(budgetCaps.scope, scope),
        eq(budgetCaps.unit, unit),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db.update(budgetCaps).set({ capAmount }).where(eq(budgetCaps.id, existing[0].id));
  } else {
    await db.insert(budgetCaps).values({
      orgId: org.id,
      department,
      scope,
      unit,
      capAmount,
    });
  }

  revalidatePath("/dashboard/budgets");
}

/**
 * Resets currentSpend to 0. There's no automatic period rollover yet (a
 * daily/monthly cap doesn't reset itself on a schedule) — this is the
 * manual stand-in until that's built. Real gap, not hidden: a customer
 * relying on a daily cap today has to reset it by hand.
 */
export async function resetBudgetSpend(formData: FormData) {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const budgetCapId = formData.get("budgetCapId");
  if (typeof budgetCapId !== "string") throw new Error("Invalid form submission.");

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const [updated] = await db
    .update(budgetCaps)
    .set({ currentSpend: "0", periodStart: new Date() })
    .where(and(eq(budgetCaps.id, budgetCapId), eq(budgetCaps.orgId, org.id)))
    .returning({ id: budgetCaps.id });

  if (!updated) throw new Error("Budget cap not found, or not in this organization.");

  revalidatePath("/dashboard/budgets");
}
