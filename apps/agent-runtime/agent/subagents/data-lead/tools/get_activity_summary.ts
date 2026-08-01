import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, activityLog } from "@foundry/db";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Third reference tool, and the first fully working one end-to-end (no
 * `throw` placeholder) — riskClass "reversible-low" means
 * packages/guardrails' enforce() skips human approval entirely even under
 * `draft_only` (see enforce.ts's `isSideEffecting` check), so this tool
 * has no `approval` field at all. That also means it skips enforce()'s
 * kill-switch check, budget check, allowlist, and rate limit — none of
 * which apply to a pure read except the kill switch: a paused department
 * should stop reads too, not just gated actions. `assertNotKilled()`
 * covers just that one case explicitly, since it's the only enforce()
 * check that should still apply here.
 */
export default defineTool({
  description: "Summarize this organization's own agent activity over a recent window.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(90).default(7),
  }),
  async execute({ days }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "data-lead" }, dbDeps);

    const windowStart = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await db
      .select({
        department: activityLog.department,
        eventType: activityLog.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.orgId, orgId), gte(activityLog.timestamp, windowStart)))
      .groupBy(activityLog.department, activityLog.eventType);

    return { days, breakdown: rows };
  },
});
