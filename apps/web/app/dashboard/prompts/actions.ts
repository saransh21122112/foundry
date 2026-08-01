"use server";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { requireOrgAdmin } from "@/lib/authz";
import { AGENT_PROMPTS } from "./agents";

/**
 * apps/web's process.cwd() at runtime is apps/web itself, and
 * apps/agent-runtime is its sibling (both direct children of apps/) — this
 * only works because it's the same local checkout on the same disk (see
 * the plan's "local dev-only tool" caveat). Never a path from the client:
 * only an allowlisted agentId looked up here maps to a hardcoded path.
 */
function resolvePath(agentId: string): string {
  const entry = AGENT_PROMPTS.find((a) => a.id === agentId);
  if (!entry) throw new Error(`Unknown agentId: ${agentId}`);
  return path.join(process.cwd(), "..", "agent-runtime", entry.path);
}

export async function readAgentPrompt(agentId: string): Promise<string> {
  return readFile(resolvePath(agentId), "utf-8");
}

/** Admin-gated: editing a prompt changes behavior for the whole org. */
export async function saveAgentPrompt(agentId: string, content: string): Promise<void> {
  await requireOrgAdmin();
  await writeFile(resolvePath(agentId), content, "utf-8");
}

/**
 * Drafts a revised instructions.md from a plain-English change request (e.g.
 * "give this agent permission to post to Slack" or "make it always ask
 * before touching production data") — same model eve itself runs on
 * (`anthropic/claude-sonnet-5` via the Vercel AI Gateway, same
 * AI_GATEWAY_API_KEY apps/agent-runtime already uses).
 *
 * Deliberately does NOT save anything — returns the proposed text so it
 * lands back in the editor's textarea for review/further editing, and only
 * `saveAgentPrompt` (a real admin action, unchanged) ever writes to disk.
 * Same "draft, don't auto-act" shape as every other AI-touched surface in
 * this product (Approval queue, budget caps): the model proposes, a human
 * approves by clicking Save.
 */
export async function generatePromptEdit(agentId: string, changeRequest: string): Promise<string> {
  await requireOrgAdmin();
  const current = await readAgentPrompt(agentId);

  const { text } = await generateText({
    model: gateway("anthropic/claude-sonnet-5"),
    system:
      "You rewrite AI agent instruction files (instructions.md — plain markdown system prompts for an autonomous agent). " +
      "You will be given the CURRENT full content of the file and a CHANGE REQUEST describing what to add, change, or grant. " +
      "Output ONLY the complete revised file content — no commentary, no code fences, no explanation before or after. " +
      "Preserve the existing structure, section headers, and voice wherever the change request doesn't require touching them — " +
      "this is a targeted edit, not a rewrite. If the change request asks for a real-world capability (e.g. a new tool, a new " +
      "permission, access to an external service) that has no corresponding tool wired up in this codebase, say so as a clearly " +
      "marked TODO/note within the file rather than inventing a tool reference that doesn't exist — that exact mistake (an " +
      "instruction pointing at a nonexistent tool) already caused a real bug in this product once.",
    prompt: `CURRENT CONTENT:\n\n${current}\n\n---\n\nCHANGE REQUEST:\n\n${changeRequest}`,
  });

  return text;
}
