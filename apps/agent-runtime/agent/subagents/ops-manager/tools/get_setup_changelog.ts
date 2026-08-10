import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { db, integrations, departmentConfigs } from "@foundry/db";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Backs the chief-of-staff briefing's "what's new in your setup" section
 * (agent/schedules/chief-of-staff-briefing.ts) — a recap of changes to this
 * org's own Foundry configuration, not its business activity (that's
 * get_company_digest.ts).
 *
 * Two honest limitations, not bugs:
 * - `newIntegrations` reads `integrations.connectedAt`, which is only ever
 *   set on the *original* connection — the OAuth callback routes (e.g.
 *   dashboard/connections/github/callback/route.ts) `update()` the row on
 *   a reconnect without touching `connectedAt`. So this reports genuinely
 *   new connections only, never reconnects.
 * - `departmentChanges` reads `departmentConfigs.updatedAt`, which only
 *   proves *that* a department's config row changed since the window
 *   started — not *what* changed (enabled toggled vs. autonomy level
 *   bumped), since there's no audit-history table and activityLog has no
 *   department-config-change event type. Good enough for a prose "here's
 *   what's new" line; not a precise audit trail (/dashboard/compliance is
 *   the tool for that).
 */
export default defineTool({
  description:
    "List what changed in this organization's own Foundry setup over the past N hours (default 168 = 1 week) — newly connected integrations and departments whose config changed. Use this for a 'what's new in your setup' recap, not business activity.",
  inputSchema: z.object({
    hours: z.number().int().min(1).max(720).default(168),
  }),
  async execute({ hours }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "ops-manager" }, dbDeps);

    const windowStart = new Date(Date.now() - hours * 60 * 60_000);

    const newIntegrations = await db
      .select({ provider: integrations.provider, connectedAt: integrations.connectedAt })
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), gte(integrations.connectedAt, windowStart)));

    const departmentChanges = await db
      .select({
        department: departmentConfigs.department,
        enabled: departmentConfigs.enabled,
        autonomyLevel: departmentConfigs.autonomyLevel,
        updatedAt: departmentConfigs.updatedAt,
      })
      .from(departmentConfigs)
      .where(and(eq(departmentConfigs.orgId, orgId), gte(departmentConfigs.updatedAt, windowStart)));

    return { hours, newIntegrations, departmentChanges };
  },
});
