import type { Department, GuardrailDeps } from "./types.js";

/**
 * For `reversible-low` tools, which correctly skip `approval`/`enforce()`
 * entirely (see eve-adapter.ts's docs on riskClass) — but that means they
 * also skip the kill switch, the department on/off switch, AND the
 * autonomy-off level, which is wrong. A paused/killed/disabled/off
 * department should stop *all* its tools, reads included, not just the
 * gated ones. Call this at the top of `execute()` for any tool with no
 * `approval` field. Throws (rather than returning a boolean) so a tool
 * author can't accidentally ignore the result the way they could a missed
 * `if`.
 *
 * Mirrors enforce()'s own kill-switch → department-enabled → autonomy-level
 * ordering (see enforce.ts steps 1-3) so a reversible-low tool and a gated
 * tool agree on which reason a caller sees first.
 */
export async function assertNotKilled(
  ctx: { orgId: string; department: Department },
  deps: GuardrailDeps,
): Promise<void> {
  if (await deps.isKillSwitchActive(ctx.orgId, ctx.department)) {
    throw new Error(`${ctx.department} is paused by an organization kill switch.`);
  }
  if (!(await deps.isDepartmentEnabled(ctx.orgId, ctx.department))) {
    throw new Error(`${ctx.department} is turned off for this organization.`);
  }
  if ((await deps.getAutonomyLevel(ctx.orgId, ctx.department)) === "off") {
    throw new Error(`${ctx.department} has its autonomy level set to Off for this organization.`);
  }
}
