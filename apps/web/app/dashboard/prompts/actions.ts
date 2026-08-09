"use server";

import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { agentPromptOverrides, db, ensureOrganization, organizations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";
import { AGENT_PROMPTS } from "./agents";

/**
 * apps/web and apps/agent-runtime run as two separate containers in
 * production (web on ECS Fargate, agent-runtime on ECS EC2) with no shared
 * filesystem, so this can no longer read agent-runtime's
 * instructions.default.ts files off local disk (that assumption held only
 * in local dev, where both apps happen to be the same checkout on the same
 * disk — broke live in prod as a real ENOENT 500 on this page, 2026-08-06).
 * Fetches the default content over HTTP instead, from a small custom eve
 * channel exposed by agent-runtime for exactly this
 * (apps/agent-runtime/agent/channels/prompt-defaults.ts) — same
 * fetch-with-bearer-token pattern this app already uses for the same
 * cross-service boundary elsewhere (apps/web/lib/eve-client.ts,
 * apps/web/app/dashboard/run/actions.ts). `bearerToken` is the calling
 * admin's own Clerk session token (see requireOrgAdmin), so agent-runtime's
 * clerkOrgSession() route auth resolves the same caller rather than needing
 * a separate service credential.
 */
async function readDefaultPrompt(agentId: string, bearerToken: string): Promise<string> {
  const entry = AGENT_PROMPTS.find((a) => a.id === agentId);
  if (!entry) throw new Error(`Unknown agentId: ${agentId}`);

  const runtimeUrl = process.env.AGENT_RUNTIME_URL;
  if (!runtimeUrl) {
    throw new Error("AGENT_RUNTIME_URL is not set — point it at the running eve agent-runtime.");
  }

  const res = await fetch(`${runtimeUrl.replace(/\/$/, "")}/eve/v1/prompt-defaults/${encodeURIComponent(agentId)}`, {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch default instructions for ${agentId}: ${res.status} ${await res.text()}`);
  }
  const { content } = (await res.json()) as { content: string };
  return content;
}

/**
 * Reads this org's own override if one has been saved, otherwise falls
 * back to the shared default content — same precedence the agent-runtime
 * resolver uses, so what an admin sees here matches what the agent is
 * actually told at runtime.
 */
export async function readAgentPrompt(agentId: string): Promise<string> {
  const { clerkOrgId, orgSlug, getToken } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const [override] = await db
    .select({ content: agentPromptOverrides.content })
    .from(agentPromptOverrides)
    .where(and(eq(agentPromptOverrides.orgId, org.id), eq(agentPromptOverrides.agentId, agentId)));

  if (override) return override.content;

  const token = await getToken();
  if (!token) throw new Error("Could not get a session token.");
  return readDefaultPrompt(agentId, token);
}

/**
 * Admin-gated: editing a prompt changes behavior for every session this
 * org runs. Upserts into agentPromptOverrides — this org's own copy, other
 * orgs are unaffected. Never touches the filesystem; the default
 * instructions.default.ts files are read-only fallback content now.
 */
export async function saveAgentPrompt(agentId: string, content: string): Promise<void> {
  const { clerkOrgId, orgSlug, userId } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .insert(agentPromptOverrides)
    .values({ orgId: org.id, agentId, content, updatedByClerkUserId: userId })
    .onConflictDoUpdate({
      target: [agentPromptOverrides.orgId, agentPromptOverrides.agentId],
      set: { content, updatedByClerkUserId: userId, updatedAt: new Date() },
    });
}

/** This org's `description`/`website` — same fields set during onboarding, editable here too. */
export async function getOrgProfile(): Promise<{ description: string | null; website: string | null }> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [row] = await db
    .select({ description: organizations.description, website: organizations.website })
    .from(organizations)
    .where(eq(organizations.id, org.id));
  return row ?? { description: null, website: null };
}

/** Admin-gated update of this org's `description`/`website`, same fields onboarding writes. */
export async function saveOrgProfile(description: string, website: string): Promise<void> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .update(organizations)
    .set({
      description: description.trim() ? description.trim() : null,
      website: website.trim() ? website.trim() : null,
    })
    .where(eq(organizations.id, org.id));
}

/**
 * Drafts a revised instructions.md from a plain-English change request (e.g.
 * "give this agent permission to post to Slack" or "make it always ask
 * before touching production data") — same model eve itself runs on
 * (`claude-sonnet-5` via the direct Anthropic API, same ANTHROPIC_API_KEY
 * apps/agent-runtime already uses).
 *
 * Deliberately does NOT save anything — returns the proposed text so it
 * lands back in the editor's textarea for review/further editing, and only
 * `saveAgentPrompt` (a real admin action) ever writes the override.
 * Same "draft, don't auto-act" shape as every other AI-touched surface in
 * this product (Approval queue, budget caps): the model proposes, a human
 * approves by clicking Save.
 */
export async function generatePromptEdit(agentId: string, changeRequest: string): Promise<string> {
  await requireOrgAdmin();
  const current = await readAgentPrompt(agentId);

  const { text } = await generateText({
    model: anthropic("claude-sonnet-5"),
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
