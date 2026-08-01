"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, ensureOrganization, toolAllowlists } from "@foundry/db";
import { DEPARTMENTS, KNOWN_TOOLS, type Department } from "@foundry/shared-types";
import { requireOrgAdmin } from "@/lib/authz";

/**
 * Upserts a tool_allowlists row. Admin-only. Only meaningful for tools
 * `enforce()` actually checks the allowlist for (see KNOWN_TOOLS' `gated`
 * flag) — rejects anything else rather than silently no-oping, since a
 * toggle that visibly does nothing is worse than an error.
 */
export async function setToolAllowed(formData: FormData) {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();

  const department = formData.get("department");
  const toolName = formData.get("toolName");
  const allowed = formData.get("allowed") === "on";

  if (typeof department !== "string" || !DEPARTMENTS.includes(department as Department)) {
    throw new Error("Invalid form submission.");
  }
  const known = KNOWN_TOOLS[department as Department].find((t) => t.name === toolName);
  if (!known || !known.gated) {
    throw new Error(`${toolName} is not a known, allowlist-gated tool for ${department}.`);
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const existing = await db
    .select({ id: toolAllowlists.id })
    .from(toolAllowlists)
    .where(
      and(
        eq(toolAllowlists.orgId, org.id),
        eq(toolAllowlists.department, department as Department),
        eq(toolAllowlists.toolName, known.name),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db.update(toolAllowlists).set({ allowed }).where(eq(toolAllowlists.id, existing[0].id));
  } else {
    await db.insert(toolAllowlists).values({
      orgId: org.id,
      department: department as Department,
      toolName: known.name,
      allowed,
    });
  }

  revalidatePath("/dashboard/tools");
}
