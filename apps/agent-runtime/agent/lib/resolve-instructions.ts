import { defineDynamic, defineInstructions } from "eve/instructions";
import { and, eq, desc } from "drizzle-orm";
import { db, agentPromptOverrides, organizations, agentMemories } from "@foundry/db";
import type { Department } from "@foundry/shared-types";

/**
 * Builds the "## About this organization" section prepended to every
 * agent's resolved markdown, grounding it in this org's real business
 * instead of generic boilerplate. Returns "" (nothing prepended) if
 * neither field is set, so a fresh org with no description looks exactly
 * like today's behavior.
 */
function buildOrgPreamble(description: string | null, website: string | null): string {
  if (!description && !website) return "";
  const lines = ["## About this organization", ""];
  if (description) lines.push(description, "");
  if (website) lines.push(`Website: ${website}`, "");
  return lines.join("\n") + "\n";
}

/**
 * eve has no cross-session memory primitive (defineState is session-scoped
 * only — see node_modules/eve/docs/patterns/multi-tenant-memory.md, which
 * documents exactly this inject-on-session-start pattern). Written by the
 * remember/recall/forget tools (agent/subagents/<dept>/tools/), scoped to
 * the department root (a nested subagent like "swe-lead/frontend-developer"
 * shares its parent's memory rather than getting its own silo — the enum
 * this table's `department` column is bound to only has the 8 top-level
 * departments, see @foundry/shared-types' DEPARTMENTS).
 */
function buildMemoryPreamble(memories: Array<{ key: string; value: string }>): string {
  if (memories.length === 0) return "";
  const lines = ["## Things you remember", ""];
  for (const m of memories) lines.push(`- **${m.key}**: ${m.value}`);
  return lines.join("\n") + "\n\n";
}

/**
 * Per-org prompt override resolver, shared by all 13 agents/subagents.
 *
 * `agentId` must match the exact id scheme in
 * apps/web/app/dashboard/prompts/agents.ts (e.g. "eng-lead",
 * "swe-lead/backend-developer") — that's what saveAgentPrompt upserts
 * against, so the lookup here has to use the same string.
 *
 * Runs on session.started (not turn/step): the org doesn't change mid
 * session, and this keeps the DB round-trip to once per session.
 */
export function resolveInstructions(agentId: string, defaultMarkdown: string) {
  return defineDynamic({
    events: {
      "session.started": async (_event, ctx) => {
        const orgId = ctx.session.auth.current?.attributes?.orgId;
        if (typeof orgId === "string") {
          const rootDepartment = agentId.split("/")[0] as Department;
          const [[override], [org], memories] = await Promise.all([
            db
              .select({ content: agentPromptOverrides.content })
              .from(agentPromptOverrides)
              .where(and(eq(agentPromptOverrides.orgId, orgId), eq(agentPromptOverrides.agentId, agentId))),
            db
              .select({ description: organizations.description, website: organizations.website })
              .from(organizations)
              .where(eq(organizations.id, orgId)),
            db
              .select({ key: agentMemories.key, value: agentMemories.value })
              .from(agentMemories)
              .where(and(eq(agentMemories.orgId, orgId), eq(agentMemories.department, rootDepartment)))
              .orderBy(desc(agentMemories.updatedAt)),
          ]);
          const preamble = buildOrgPreamble(org?.description ?? null, org?.website ?? null);
          const memoryPreamble = buildMemoryPreamble(memories);
          const markdown = preamble + memoryPreamble + (override ? override.content : defaultMarkdown);
          return defineInstructions({ markdown });
        }
        return defineInstructions({ markdown: defaultMarkdown });
      },
    },
  });
}
