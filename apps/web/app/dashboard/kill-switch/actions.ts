"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { activityLog, db, ensureOrganization, killSwitches } from "@foundry/db";
import { DEPARTMENTS, type Department } from "@foundry/shared-types";
import { requireOrgAdmin } from "@/lib/authz";

const KILL_EVERYTHING_CONFIRM = "KILL EVERYTHING";

/**
 * Triggers a kill switch — org-wide (department omitted/empty) or scoped to
 * one department. This is a real emergency stop: packages/guardrails'
 * isKillSwitchActive() is the first check every enforce() call makes, so an
 * active row here blocks every tool call for the org (or department)
 * immediately, regardless of autonomy level. Admin-gated, same as
 * Departments/Budgets. Org-wide requires typing a confirmation phrase
 * server-side (not just client-side) so a stray click can't kill the org.
 */
export async function triggerKillSwitch(formData: FormData) {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();

  const departmentRaw = formData.get("department");
  const reasonRaw = formData.get("reason");
  const confirmRaw = formData.get("confirm");

  if (typeof departmentRaw !== "string" || typeof reasonRaw !== "string") {
    throw new Error("Invalid form submission.");
  }
  const department = departmentRaw === "" ? null : (departmentRaw as Department);
  if (department !== null && !DEPARTMENTS.includes(department)) {
    throw new Error("Invalid form submission.");
  }
  if (department === null && confirmRaw !== KILL_EVERYTHING_CONFIRM) {
    throw new Error(`Type "${KILL_EVERYTHING_CONFIRM}" to confirm an org-wide kill.`);
  }
  const reason = reasonRaw.trim() || null;

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db.insert(killSwitches).values({
    orgId: org.id,
    department,
    active: true,
    triggeredByClerkUserId: userId,
    reason,
  });

  await db.insert(activityLog).values({
    orgId: org.id,
    department,
    agentRunId: "manual:kill-switch",
    eventType: "kill_switch_triggered",
    toolInput: reason ? { reason } : undefined,
    actor: userId,
  });

  revalidatePath("/dashboard/kill-switch");
  revalidatePath("/dashboard/activity");
}

/** Deactivates a kill switch — the way back on once triggered. */
export async function resolveKillSwitch(formData: FormData) {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();

  const killSwitchId = formData.get("killSwitchId");
  if (typeof killSwitchId !== "string") throw new Error("Invalid form submission.");

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const [updated] = await db
    .update(killSwitches)
    .set({ active: false })
    .where(and(eq(killSwitches.id, killSwitchId), eq(killSwitches.orgId, org.id)))
    .returning({ id: killSwitches.id, department: killSwitches.department });

  if (!updated) throw new Error("Kill switch not found, or not in this organization.");

  await db.insert(activityLog).values({
    orgId: org.id,
    department: updated.department,
    agentRunId: "manual:kill-switch",
    eventType: "kill_switch_resolved",
    actor: userId,
  });

  revalidatePath("/dashboard/kill-switch");
  revalidatePath("/dashboard/activity");
}
