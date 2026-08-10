import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db, agentMemories } from "@foundry/db";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import type { Department } from "@foundry/shared-types";

/**
 * Cross-session memory, shared by every department. eve's own
 * `connections`/`tools` directories are only discovered per-subagent (see
 * eng-lead/connections/github.ts's comment), so there's no single place to
 * register a tool once for all 8 departments — each subagent's tools/
 * directory gets a thin `export default makeRememberTool("<dept>")`-style
 * file (see e.g. subagents/ops-manager/tools/remember.ts) that just binds
 * this shared implementation to that department. Keeps the actual logic in
 * one place instead of duplicated 8 times.
 *
 * riskClass "reversible-low", ungated — same convention as
 * get_daily_ops_digest.ts / list_public_github_repos.ts: writing a private
 * note to yourself isn't a side effect this app's guardrails need to gate,
 * same reasoning as those existing pure-read/no-external-effect tools.
 */

function requireOrgId(ctx: {
  session: { auth: { current?: { attributes?: Record<string, unknown> } | null } };
}): string {
  const orgId = ctx.session.auth.current?.attributes?.orgId;
  if (typeof orgId !== "string") {
    throw new Error("No organization resolved on this session.");
  }
  return orgId;
}

export function makeRememberTool(department: Department) {
  return defineTool({
    description:
      "Save a short note to this department's persistent memory, so it's available in every future session (not just this one). Use for durable facts/preferences worth remembering — not scratch state for the current task. Overwrites any existing note with the same key.",
    inputSchema: z.object({
      key: z.string().min(1).max(200),
      value: z.string().min(1).max(4000),
    }),
    async execute({ key, value }, ctx) {
      const orgId = requireOrgId(ctx);
      await assertNotKilled({ orgId, department }, dbDeps);
      await db
        .insert(agentMemories)
        .values({ orgId, department, key, value })
        .onConflictDoUpdate({
          target: [agentMemories.orgId, agentMemories.department, agentMemories.key],
          set: { value, updatedAt: new Date() },
        });
      return { remembered: true, key };
    },
  });
}

export function makeRecallTool(department: Department) {
  return defineTool({
    description:
      "List everything currently saved in this department's persistent memory. Use this to check what you already know before asking the user something you might have been told before.",
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      const orgId = requireOrgId(ctx);
      await assertNotKilled({ orgId, department }, dbDeps);
      const memories = await db
        .select({ key: agentMemories.key, value: agentMemories.value, updatedAt: agentMemories.updatedAt })
        .from(agentMemories)
        .where(and(eq(agentMemories.orgId, orgId), eq(agentMemories.department, department)))
        .orderBy(desc(agentMemories.updatedAt));
      return { memories };
    },
  });
}

export function makeForgetTool(department: Department) {
  return defineTool({
    description: "Delete a note from this department's persistent memory by key.",
    inputSchema: z.object({
      key: z.string().min(1).max(200),
    }),
    async execute({ key }, ctx) {
      const orgId = requireOrgId(ctx);
      await assertNotKilled({ orgId, department }, dbDeps);
      const deleted = await db
        .delete(agentMemories)
        .where(and(eq(agentMemories.orgId, orgId), eq(agentMemories.department, department), eq(agentMemories.key, key)))
        .returning({ key: agentMemories.key });
      return { forgotten: deleted.length > 0, key };
    },
  });
}
