"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { db, ensureOrganization, runSessions } from "@foundry/db";

/**
 * Starts a new eve session with the given message as the root orchestrator's
 * first instruction. Any signed-in org member can run a task — unlike
 * configuring autonomy/budgets, using the AI company day-to-day isn't
 * admin-only (see lib/authz.ts's requireOrgAdmin, deliberately not used
 * here).
 *
 * Also records the session in our own `run_sessions` index so this page
 * can list an org's tasks (see listTasks below) — eve itself has no
 * list-sessions endpoint; this is the "application concern" its own docs
 * point to (patterns/multi-tenant-approvals.md). Calendar reads the same
 * table to show "every task your company has run".
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
 *
 * eve authenticates the CALLER but doesn't know which org owns a given
 * session id — eve's own docs (patterns/multi-tenant-auth.md) say that ACL
 * is the application's job. `sessionId` comes straight from client input, so
 * without this check, any signed-in member of ANY org who learns another
 * org's session id (visible in that org's own `?session=` URL) could read
 * or interject into that org's live session. Found by a live isolation
 * audit (2026-08-02) — confirmed no such check existed anywhere on this path.
 */
export async function sendFollowUp(sessionId: string, continuationToken: string, message: string): Promise<void> {
  const { userId, orgId: clerkOrgId, orgSlug, getToken } = await auth();
  if (!userId) throw new Error("Not signed in.");
  if (!clerkOrgId) throw new Error("Select or create an organization first.");
  const token = await getToken();
  if (!token) throw new Error("Could not get a session token.");

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [owned] = await db
    .select({ id: runSessions.id })
    .from(runSessions)
    .where(and(eq(runSessions.id, sessionId), eq(runSessions.orgId, org.id)))
    .limit(1);
  if (!owned) throw new Error("Session not found.");

  const res = await fetch(`${process.env.AGENT_RUNTIME_URL}/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ continuationToken, message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send reply: ${res.status} ${await res.text()}`);
  }
}
