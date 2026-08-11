import { and, desc, eq } from "drizzle-orm";
import { db, agentMemories, agentPromptOverrides, organizations } from "@foundry/db";
import type { Department } from "@foundry/shared-types";

/**
 * Same resolution logic as agent/lib/resolve-instructions.ts (org preamble
 * + remembered-facts preamble + prompt override or default), reimplemented
 * as a plain async function against the new runtime's session shape
 * instead of eve's `session.started` dynamic-instructions hook. The
 * underlying DB reads are identical — only the "when this runs" wrapper
 * changes (called once per new run here, not by an eve event).
 */
export async function resolveInstructions(
  agentId: string,
  department: Department,
  orgId: string | undefined,
  defaultMarkdown: string,
): Promise<string> {
  if (!orgId) return defaultMarkdown;

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
      .where(and(eq(agentMemories.orgId, orgId), eq(agentMemories.department, department)))
      .orderBy(desc(agentMemories.updatedAt)),
  ]);

  const orgPreamble =
    org?.description || org?.website
      ? `## About this organization\n\n${org.description ? org.description + "\n\n" : ""}${
          org.website ? `Website: ${org.website}\n\n` : ""
        }`
      : "";
  const memoryPreamble =
    memories.length > 0
      ? `## Things you remember\n\n${memories.map((m) => `- **${m.key}**: ${m.value}`).join("\n")}\n\n`
      : "";

  return orgPreamble + memoryPreamble + (override ? override.content : defaultMarkdown);
}
