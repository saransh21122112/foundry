import { and, desc, eq, ne } from "drizzle-orm";
import { approvalRequests, db, departmentSettings } from "@foundry/db";
import type { Department } from "@foundry/shared-types";

const STREAK_WINDOW = 10;

function dismissalKey(department: Department): string {
  return `autonomy_suggestion_dismissed:${department}`;
}

/**
 * Purely informational — never writes to departmentConfigs, never touches
 * autonomyLevel. See apps/web/app/dashboard/departments/page.tsx: this
 * only decides whether to show a callout next to the existing (manual)
 * autonomy radio group.
 */
export async function computeAutonomySuggestion(
  orgId: string,
  department: Department,
): Promise<{ eligible: boolean; streakCount: number; dismissed: boolean }> {
  const recent = await db
    .select({ status: approvalRequests.status, resolvedAt: approvalRequests.resolvedAt })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.department, department), ne(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.resolvedAt))
    .limit(STREAK_WINDOW);

  const streakCount = recent.length;
  const eligible = streakCount === STREAK_WINDOW && recent.every((r) => r.status === "approved");

  const [dismissal] = await db
    .select({ value: departmentSettings.value })
    .from(departmentSettings)
    .where(and(eq(departmentSettings.orgId, orgId), eq(departmentSettings.department, department), eq(departmentSettings.key, dismissalKey(department))))
    .limit(1);

  let dismissed = false;
  if (dismissal?.value && typeof dismissal.value === "object" && "dismissedAt" in dismissal.value) {
    const dismissedAt = new Date((dismissal.value as { dismissedAt: string }).dismissedAt);
    const newestResolvedAt = recent[0]?.resolvedAt ?? null;
    // Still dismissed unless the org has earned a newer approval since —
    // re-surface once there's fresh evidence, don't stay silenced forever.
    dismissed = !(newestResolvedAt && newestResolvedAt > dismissedAt);
  }

  return { eligible, streakCount, dismissed };
}
