"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { db, ensureOrganization, runSessions } from "@foundry/db";

export interface CalendarTask {
  id: string;
  title: string;
  createdAt: Date;
  status: string | null;
}

/** Same org-scoping pattern as run/actions.ts's listTasks, just with `status` included and a wider window for the calendar/board views. */
export async function listCalendarTasks(): Promise<CalendarTask[]> {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkOrgId) return [];

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  return db
    .select({ id: runSessions.id, title: runSessions.title, createdAt: runSessions.createdAt, status: runSessions.status })
    .from(runSessions)
    .where(eq(runSessions.orgId, org.id))
    .orderBy(desc(runSessions.createdAt))
    .limit(200);
}

/** v1 status set for the kanban board — same ownership check as run/actions.ts's sendFollowUp, since sessionId comes straight from client input. */
export async function setTaskStatus(sessionId: string, status: string | null): Promise<void> {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkOrgId) throw new Error("Select or create an organization first.");

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [owned] = await db
    .select({ id: runSessions.id })
    .from(runSessions)
    .where(and(eq(runSessions.id, sessionId), eq(runSessions.orgId, org.id)))
    .limit(1);
  if (!owned) throw new Error("Task not found.");

  await db.update(runSessions).set({ status }).where(eq(runSessions.id, sessionId));
}
