import { defineDynamic, defineInstructions } from "eve/instructions";
import { and, eq } from "drizzle-orm";
import { db, agentPromptOverrides, organizations } from "@foundry/db";

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
          const [[override], [org]] = await Promise.all([
            db
              .select({ content: agentPromptOverrides.content })
              .from(agentPromptOverrides)
              .where(and(eq(agentPromptOverrides.orgId, orgId), eq(agentPromptOverrides.agentId, agentId))),
            db
              .select({ description: organizations.description, website: organizations.website })
              .from(organizations)
              .where(eq(organizations.id, orgId)),
          ]);
          const preamble = buildOrgPreamble(org?.description ?? null, org?.website ?? null);
          const markdown = preamble + (override ? override.content : defaultMarkdown);
          return defineInstructions({ markdown });
        }
        return defineInstructions({ markdown: defaultMarkdown });
      },
    },
  });
}
