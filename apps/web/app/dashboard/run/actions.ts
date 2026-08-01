"use server";

import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { db, ensureOrganization, runSessions } from "@foundry/db";

/**
 * Starts a new eve session with the given message as the root orchestrator's
 * first instruction. Any signed-in org member can run a task — unlike
 * configuring autonomy/budgets, using the AI company day-to-day isn't
 * admin-only (see lib/authz.ts's requireOrgAdmin, deliberately not used
 * here).
 *
 * Also records the session in our own `run_sessions` index so the Run page
 * can list an org's tasks (see listTasks below) — eve itself has no
 * list-sessions endpoint; this is the "application concern" its own docs
 * point to (patterns/multi-tenant-approvals.md).
 */
export async function startTask(message: string): Promise<{ sessionId: string }> {
  const { userId, orgId: clerkOrgId, orgSlug, getToken } = await auth();
  if (!userId) throw new Error("Not signed in.");
  if (!clerkOrgId) throw new Error("Select or create an organization first.");
  const token = await getToken();
  if (!token) throw new Error("Could not get a session token.");

  const res = await fetch(`${process.env.AGENT_RUNTIME_URL}/eve/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to start task: ${res.status} ${await res.text()}`);
  }
  const sessionId = res.headers.get("x-eve-session-id");
  if (!sessionId) throw new Error("Agent runtime didn't return a session id.");

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const title = message.length > 80 ? `${message.slice(0, 79)}…` : message;
  await db.insert(runSessions).values({ id: sessionId, orgId: org.id, createdByClerkUserId: userId, title });

  return { sessionId };
}

/** Lists this org's tasks, most recent first, for the session manager. */
export async function listTasks(): Promise<Array<{ id: string; title: string; createdAt: Date }>> {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkOrgId) return [];

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  return db
    .select({ id: runSessions.id, title: runSessions.title, createdAt: runSessions.createdAt })
    .from(runSessions)
    .where(eq(runSessions.orgId, org.id))
    .orderBy(desc(runSessions.createdAt))
    .limit(30);
}

/**
 * Sends a reply to a session parked on `session.waiting` — the same route
 * handles a plain conversational continuation, an `ask_question` answer, and
 * a "approve"/"deny" text reply to a pending tool approval (see eve's docs,
 * concepts/sessions-runs-and-streaming.md#send-a-follow-up-message). One
 * chat box covers all three instead of needing separate UI per case.
 */
export async function sendFollowUp(sessionId: string, continuationToken: string, message: string): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("Not signed in.");
  const token = await getToken();
  if (!token) throw new Error("Could not get a session token.");

  const res = await fetch(`${process.env.AGENT_RUNTIME_URL}/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ continuationToken, message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send reply: ${res.status} ${await res.text()}`);
  }
}
