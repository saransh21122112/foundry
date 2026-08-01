import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  activityLog,
  approvalRequests,
  budgetCaps,
  departmentConfigs,
  departmentSettings,
  killSwitches,
  toolAllowlists,
} from "@foundry/db";
import type { GuardrailDeps } from "./types.js";

const DEFAULT_RATE_LIMIT_WINDOW_MINUTES = 60;
const DEFAULT_RATE_LIMIT_MAX_CALLS = 20;

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
          eq(budgetCaps.department, department),
          eq(budgetCaps.unit, cost.unit),
        ),
      );
    if (rows.length === 0) return { withinBudget: true }; // no cap configured = uncapped

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTH_MS = 30 * DAY_MS;

    // For each cumulative row, compute its rollover-adjusted effective spend
    // (0 if its period has elapsed, else its stored currentSpend) without
    // mutating the row yet — every row must be checked before any is written.
    const effective = rows.map((row) => {
      if (row.scope === "per_run") {
        return { row, rolledOver: false, currentSpend: 0 };
      }
      const windowMs = row.scope === "daily" ? DAY_MS : MONTH_MS;
      const rolledOver = now - new Date(row.periodStart).getTime() > windowMs;
      return { row, rolledOver, currentSpend: rolledOver ? 0 : Number(row.currentSpend) };
    });

    for (const { row, currentSpend } of effective) {
      const projected = row.scope === "per_run" ? cost.amount : currentSpend + cost.amount;
      if (projected > Number(row.capAmount)) {
        return { withinBudget: false };
      }
    }

    for (const { row, rolledOver, currentSpend } of effective) {
      if (row.scope === "per_run") continue; // not cumulative, never persisted
      await db
        .update(budgetCaps)
        .set({
          currentSpend: String(currentSpend + cost.amount),
          ...(rolledOver ? { periodStart: new Date(now) } : {}),
        })
        .where(eq(budgetCaps.id, row.id));
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
