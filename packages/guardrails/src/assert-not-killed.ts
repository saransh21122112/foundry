import type { Department, GuardrailDeps } from "./types.js";

/**
 * For `reversible-low` tools, which correctly skip `approval`/`enforce()`
 * entirely (see eve-adapter.ts's docs on riskClass) — but that means they
 * also skip the kill switch, which is wrong. A paused/killed department
 * should stop *all* its tools, reads included, not just the gated ones.
 * Call this at the top of `execute()` for any tool with no `approval`
 * field. Throws (rather than returning a boolean) so a tool author can't
 * accidentally ignore the result the way they could a missed `if`.
 */
export async function assertNotKilled(
  ctx: { orgId: string; department: Department },
  deps: GuardrailDeps,
): Promise<void> {
  if (await deps.isKillSwitchActive(ctx.orgId, ctx.department)) {
    throw new Error(`${ctx.department} is paused by an organization kill switch.`);
  }
}
