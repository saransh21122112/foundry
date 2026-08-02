"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AUTONOMY_LEVELS, DEPARTMENTS, type AutonomyLevel, type Department } from "@foundry/shared-types";
import { db, ensureOrganization, organizations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";
import { updateDepartmentConfig } from "../departments/actions";
import { updateBudgetCap } from "../budgets/actions";

const SCOPES = ["per_run", "daily", "monthly"] as const;

/**
 * Orchestrates first-run setup by calling the real Departments/Budgets
 * server actions once per selected department (plus an optional budget
 * cap) rather than writing to department_configs/budget_caps directly —
 * this is a thin wrapper, not a parallel implementation. requireOrgAdmin
 * runs here too (cheap, avoids a confusing partial-write if a non-admin
 * somehow reaches submit) even though each delegated action re-checks it.
 */
export async function submitOnboarding(formData: FormData) {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();

  const description = formData.get("description");
  const website = formData.get("website");
  if (typeof description === "string" || typeof website === "string") {
    const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
    await db
      .update(organizations)
      .set({
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        website: typeof website === "string" && website.trim() ? website.trim() : null,
      })
      .where(eq(organizations.id, org.id));
  }

  const departments = formData.getAll("department").filter((d): d is string => typeof d === "string");
  const autonomyLevel = formData.get("autonomyLevel");

  if (
    departments.length === 0 ||
    !departments.every((d) => DEPARTMENTS.includes(d as Department)) ||
    typeof autonomyLevel !== "string" ||
    !AUTONOMY_LEVELS.includes(autonomyLevel as AutonomyLevel)
  ) {
    throw new Error("Pick at least one department and an autonomy level.");
  }

  for (const department of departments) {
    const deptForm = new FormData();
    deptForm.set("department", department);
    deptForm.set("autonomyLevel", autonomyLevel);
    deptForm.set("enabled", "on");
    await updateDepartmentConfig(deptForm);
  }

  const budgetDepartment = formData.get("budgetDepartment");
  const budgetScope = formData.get("budgetScope");
  const budgetUnit = formData.get("budgetUnit");
  const budgetCapAmount = formData.get("budgetCapAmount");

  if (
    typeof budgetCapAmount === "string" &&
    budgetCapAmount.trim().length > 0 &&
    typeof budgetDepartment === "string" &&
    DEPARTMENTS.includes(budgetDepartment as Department) &&
    typeof budgetScope === "string" &&
    SCOPES.includes(budgetScope as (typeof SCOPES)[number]) &&
    typeof budgetUnit === "string" &&
    budgetUnit.trim().length > 0
  ) {
    const budgetForm = new FormData();
    budgetForm.set("department", budgetDepartment);
    budgetForm.set("scope", budgetScope);
    budgetForm.set("unit", budgetUnit);
    budgetForm.set("capAmount", budgetCapAmount);
    await updateBudgetCap(budgetForm);
  }

  redirect("/dashboard/onboarding?done=1");
}
