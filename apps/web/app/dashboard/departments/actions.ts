"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { departmentConfigs, departmentSettings, db, ensureOrganization, organizations } from "@foundry/db";
import { AUTONOMY_LEVELS, DEPARTMENTS, type AutonomyLevel, type Department } from "@foundry/shared-types";
import { requireOrgAdmin } from "@/lib/authz";

// Free plan ceiling — see ROADMAP.md Phase 4. Only two tiers exist today;
// "pro" has no ceiling at all, so the only checks needed are free-plan ones.
const FREE_PLAN_MAX_DEPARTMENTS = 2;

/**
 * Upserts this org's department_configs row for one department. Admin-only
 * (see lib/authz.ts) — this is the one screen where `bounded_autonomous`
 * gets turned on for real, not something any signed-in org member should
 * be able to flip. See ROADMAP.md Phase 4: onboarding should never default
 * a fresh org straight to bounded_autonomous, but nothing here currently
 * enforces that beyond the schema's own default (`draft_only`). Worth a
 * second look once real customers exist.
 */
export async function updateDepartmentConfig(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();

  const department = formData.get("department");
  const autonomyLevel = formData.get("autonomyLevel");
  const enabled = formData.get("enabled") === "on";

  if (
    typeof department !== "string" ||
    !DEPARTMENTS.includes(department as Department) ||
    typeof autonomyLevel !== "string" ||
    !AUTONOMY_LEVELS.includes(autonomyLevel as AutonomyLevel)
  ) {
    return { ok: false, error: "Invalid form submission." };
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const [orgRow] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  const plan = orgRow?.plan ?? "free";

  const existing = await db
    .select({ id: departmentConfigs.id })
    .from(departmentConfigs)
    .where(and(eq(departmentConfigs.orgId, org.id), eq(departmentConfigs.department, department as Department)))
    .limit(1);

  if (plan === "free") {
    if (autonomyLevel === "bounded_autonomous") {
      return { ok: false, error: "Free plan is limited to Drafts only — upgrade to allow Fully autonomous." };
    }
    if (enabled) {
      const otherEnabled = await db
        .select({ id: departmentConfigs.id })
        .from(departmentConfigs)
        .where(and(eq(departmentConfigs.orgId, org.id), eq(departmentConfigs.enabled, true), ne(departmentConfigs.department, department as Department)));
      if (otherEnabled.length >= FREE_PLAN_MAX_DEPARTMENTS) {
        return { ok: false, error: "Free plan is limited to 2 active departments — upgrade to enable more." };
      }
    }
  }

  if (existing[0]) {
    await db
      .update(departmentConfigs)
      .set({ enabled, autonomyLevel: autonomyLevel as AutonomyLevel, updatedAt: new Date() })
      .where(eq(departmentConfigs.id, existing[0].id));
  } else {
    await db.insert(departmentConfigs).values({
      orgId: org.id,
      department: department as Department,
      enabled,
      autonomyLevel: autonomyLevel as AutonomyLevel,
    });
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}

/**
 * Dismisses the "ready for more autonomy" callout for one department. Never
 * touches departmentConfigs/autonomyLevel — the callout is informational
 * only, so dismissing it is just a note-to-self, admin-gated the same as
 * every other write in this file. See lib/autonomy-suggestion.ts for the
 * key format and re-surface logic.
 */
export async function dismissAutonomySuggestion(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();

  const department = formData.get("department");
  if (typeof department !== "string" || !DEPARTMENTS.includes(department as Department)) {
    return { ok: false, error: "Invalid form submission." };
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const key = `autonomy_suggestion_dismissed:${department}`;

  const existing = await db
    .select({ id: departmentSettings.id })
    .from(departmentSettings)
    .where(and(eq(departmentSettings.orgId, org.id), eq(departmentSettings.department, department as Department), eq(departmentSettings.key, key)))
    .limit(1);

  const value = { dismissedAt: new Date().toISOString() };
  if (existing[0]) {
    await db.update(departmentSettings).set({ value }).where(eq(departmentSettings.id, existing[0].id));
  } else {
    await db.insert(departmentSettings).values({ orgId: org.id, department: department as Department, key, value });
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}
