import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  activityLog,
  approvalRequests,
  budgetCaps,
  departmentConfigs,
  departmentSettings,
  killSwitches,
  memberships,
  toolAllowlists,
} from "@foundry/db";
import { createClerkClient } from "@clerk/backend";
import { Resend } from "resend";
import type { GuardrailDeps } from "./types.js";
import { computeBudgetDecision } from "./budget-decision.js";

const DEFAULT_RATE_LIMIT_WINDOW_MINUTES = 60;
const DEFAULT_RATE_LIMIT_MAX_CALLS = 20;

// Not declared in this package's own package.json — resolved from
// apps/agent-runtime's node_modules via npm workspace hoisting (verified:
// `require.resolve("resend", { paths: [".../packages/guardrails/src"] })`
// finds the hoisted root copy). Only ever executed inside the agent-runtime
// process, same as everything else in this file.
const resend = new Resend(process.env.RESEND_API_KEY);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Mirrors apps/web/lib/copy.ts's approvalReasonLabel. Duplicated rather than
 * imported — guardrails is a package apps/web depends on, not the reverse.
 * Keep wording in sync if either changes.
 */
const APPROVAL_REASON_LABEL: Record<string, string> = {
  draft_mode: "This department is set to “Drafts only,” so this needed your OK before it could run.",
  budget_exceeded: "This would go over the budget cap you've set for this department.",
  not_in_allowlist: "This specific action is turned off for this department.",
  rate_limit_exceeded: "This department has hit its rate limit for this action — too many, too fast.",
};
function approvalReasonLabel(reason: string): string {
  if (reason.startsWith("hard_rule:")) {
    const risk = reason.slice("hard_rule:".length);
    return `This action is ${risk} — those always need your OK, no matter what autonomy level is set.`;
  }
  return APPROVAL_REASON_LABEL[reason] ?? reason;
}

/**
 * Best-effort email to every owner/admin of the org, once a tool call has
 * hard-paused waiting for approval. A notification failure must never break
 * approval-request creation itself, so every failure mode here is caught and
 * logged rather than thrown — see createApprovalRequest below.
 */
async function notifyAdminsOfApproval(input: {
  orgId: string;
  department: string;
  toolName: string;
  reason: string;
}): Promise<void> {
  const admins = await db
    .select({ clerkUserId: memberships.clerkUserId })
    .from(memberships)
    .where(and(eq(memberships.orgId, input.orgId), inArray(memberships.role, ["owner", "admin"])));

  if (admins.length === 0) {
    console.warn(`[guardrails] approval request for org ${input.orgId} has no owner/admin to notify`);
    return;
  }

  // apps/agent-runtime can't read Next's NEXT_PUBLIC_ vars, so it gets its
  // own APP_URL. TODO: this needs to become the real production URL once
  // deployed.
  const appUrl = process.env.APP_URL ?? "http://localhost:3311";
  const reasonLabel = approvalReasonLabel(input.reason);

  let sent = 0;
  for (const { clerkUserId } of admins) {
    const user = await clerk.users.getUser(clerkUserId);
    const email =
      user.emailAddresses.find((addr) => addr.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    if (!email) continue;

    const { error } = await resend.emails.send({
      from: "Foundry <onboarding@resend.dev>",
      to: email,
      subject: `Foundry: ${input.department} needs your approval`,
      text: `${input.toolName} needs your approval.\n\n${reasonLabel}\n\nReview it here: ${appUrl}/dashboard/approvals`,
    });
    if (error) {
      console.warn(`[guardrails] approval notification to ${email} failed: ${error.message}`);
      continue;
    }
    sent++;
  }
  console.log(`[guardrails] approval notification sent to ${sent}/${admins.length} admins (org ${input.orgId})`);
}

/**
 * Real, Postgres-backed implementation of GuardrailDeps. Exercised against
 * the live Neon database (see packages/db's provisioning) — the
 * insert/select/delete path underlying every method here has been verified
 * to work through drizzle, though this file's own methods aren't covered
 * by unit tests directly (those use in-memory fakes against `enforce()`,
 * see enforce.test.ts — this file is the thing those fakes stand in for).
 */
export const dbDeps: GuardrailDeps = {
  async isKillSwitchActive(orgId, department) {
    const rows = await db
      .select()
      .from(killSwitches)
      .where(
        and(
          eq(killSwitches.orgId, orgId),
          eq(killSwitches.active, true),
          sql`(${killSwitches.department} IS NULL OR ${killSwitches.department} = ${department})`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async isDepartmentEnabled(orgId, department) {
    const rows = await db
      .select({ enabled: departmentConfigs.enabled })
      .from(departmentConfigs)
      .where(and(eq(departmentConfigs.orgId, orgId), eq(departmentConfigs.department, department)))
      .limit(1);
    // No row yet = department never configured by the customer = off.
    return rows[0]?.enabled ?? false;
  },

  async getAutonomyLevel(orgId, department) {
    const rows = await db
      .select({ autonomyLevel: departmentConfigs.autonomyLevel })
      .from(departmentConfigs)
      .where(and(eq(departmentConfigs.orgId, orgId), eq(departmentConfigs.department, department)))
      .limit(1);
    // No row yet = department never configured = safest default.
    return rows[0]?.autonomyLevel ?? "draft_only";
  },

  async isToolAllowed(orgId, department, toolName) {
    const rows = await db
      .select({ allowed: toolAllowlists.allowed })
      .from(toolAllowlists)
      .where(
        and(
          eq(toolAllowlists.orgId, orgId),
          eq(toolAllowlists.department, department),
          eq(toolAllowlists.toolName, toolName),
        ),
      )
      .limit(1);
    // No explicit row = default allow (the department template's own
    // built-in tool set); an org can add a row to narrow this.
    return rows[0]?.allowed ?? true;
  },

  async checkAndReserveBudget(orgId, department, cost) {
    if (!cost) return { withinBudget: true };
    const rows = await db
      .select()
      .from(budgetCaps)
      .where(
        and(
          eq(budgetCaps.orgId, orgId),
          eq(budgetCaps.unit, cost.unit),
          // Both the department-specific cap(s) AND any org-wide cap
          // (department IS NULL) apply to this call — same null-is-org-wide
          // convention as kill_switches. Every applicable row is checked
          // before any is written, and every applicable row's spend is
          // incremented on success, same as the existing per-scope loop below.
          sql`(${budgetCaps.department} IS NULL OR ${budgetCaps.department} = ${department})`,
        ),
      );
    if (rows.length === 0) return { withinBudget: true }; // no cap configured = uncapped

    const decision = computeBudgetDecision(
      rows.map((row) => ({
        id: row.id,
        department: row.department,
        scope: row.scope as "per_run" | "daily" | "monthly",
        unit: row.unit,
        capAmount: Number(row.capAmount),
        periodStart: new Date(row.periodStart),
        currentSpend: Number(row.currentSpend),
      })),
      cost,
      new Date(),
    );
    if (decision.verdict === "deny") return { withinBudget: false };

    for (const update of decision.updates) {
      await db
        .update(budgetCaps)
        .set({
          currentSpend: String(update.currentSpend),
          ...(update.periodStart ? { periodStart: update.periodStart } : {}),
        })
        .where(eq(budgetCaps.id, update.id));
    }
    return { withinBudget: true };
  },

  async checkRateLimit(orgId, department, toolName) {
    let windowMinutes = DEFAULT_RATE_LIMIT_WINDOW_MINUTES;
    let maxCalls = DEFAULT_RATE_LIMIT_MAX_CALLS;

    // Org-specific override, e.g. { windowMinutes: 1440, maxCalls: 50 }
    // stored at department_settings(key = "rate_limit:<toolName>"). No row
    // = the flat default above applies to every tool.
    const [setting] = await db
      .select({ value: departmentSettings.value })
      .from(departmentSettings)
      .where(
        and(
          eq(departmentSettings.orgId, orgId),
          eq(departmentSettings.department, department),
          eq(departmentSettings.key, `rate_limit:${toolName}`),
        ),
      )
      .limit(1);
    if (setting?.value && typeof setting.value === "object") {
      const override = setting.value as { windowMinutes?: number; maxCalls?: number };
      if (typeof override.windowMinutes === "number") windowMinutes = override.windowMinutes;
      if (typeof override.maxCalls === "number") maxCalls = override.maxCalls;
    }

    const windowStart = new Date(Date.now() - windowMinutes * 60_000);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.orgId, orgId),
          eq(activityLog.department, department),
          eq(activityLog.toolName, toolName),
          sql`${activityLog.eventType} IN ('tool_call_allowed', 'tool_call_executed')`,
          gte(activityLog.timestamp, windowStart),
        ),
      );

    return (row?.count ?? 0) < maxCalls;
  },

  async createApprovalRequest(input) {
    const [row] = await db
      .insert(approvalRequests)
      .values({
        orgId: input.orgId,
        department: input.department,
        agentRunId: input.agentRunId,
        eveCallId: input.eveCallId,
        toolName: input.toolName,
        toolInput: input.toolInput as object,
        reason: input.reason,
      })
      .returning({ id: approvalRequests.id });

    try {
      await notifyAdminsOfApproval({
        orgId: input.orgId,
        department: input.department,
        toolName: input.toolName,
        reason: input.reason,
      });
    } catch (err) {
      console.warn("[guardrails] failed to notify admins of approval request:", err);
    }

    return { id: row.id };
  },

  async logActivity(entry) {
    await db.insert(activityLog).values({
      orgId: entry.orgId,
      department: entry.department,
      agentRunId: entry.agentRunId,
      eventType: entry.eventType,
      toolName: entry.toolName,
      toolInput: entry.toolInput as object | undefined,
      toolOutput: entry.toolOutput as object | undefined,
      actor: "agent",
    });
  },
};
