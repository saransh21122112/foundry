import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { db, ensureOrganization, memberships } from "@foundry/db";

/**
 * Throws unless the caller is an admin of the org attached to the current
 * session. Every server action that mutates something with real
 * consequence — resolving an approval, changing a department's autonomy
 * level or budget caps — must call this before touching the database.
 * Being signed in and having an org selected is not sufficient on its own;
 * any org member could otherwise approve spend or flip a department to
 * `bounded_autonomous`.
 *
 * Clerk (via `has({role})`) is the actual source of truth for admin status
 * — `packages/db`'s own `memberships` table exists to mirror that, but
 * nothing ever populated it (found live: it was completely empty despite
 * this org having a real admin the whole session), which silently broke
 * anything that reads it, e.g. approval-notification emails have nobody to
 * send to. Fixed here, opportunistically, rather than building a separate
 * Clerk-webhook sync: every time a confirmed admin calls this function, we
 * now upsert their `memberships` row too. Doesn't cover plain members (who
 * never hit this admin-only gate) or org changes made outside this app, but
 * it means every action that actually exercises admin-gated features keeps
 * the table honest for exactly the audience notifications need (admins).
 *
 * Returns the resolved `{ userId, clerkOrgId, orgSlug, getToken }` so
 * callers don't need a second `auth()` call — `getToken()` is here
 * specifically for actions that need to call the agent-runtime as this
 * same admin (see app/dashboard/approvals/actions.ts's session-resume
 * call), so the runtime's own Clerk verification resolves the same
 * tenant rather than needing a separate service credential.
 */
export async function requireOrgAdmin() {
  const session = await auth();
  const { userId, orgId: clerkOrgId, orgSlug, has, getToken } = session;

  if (!userId || !clerkOrgId) {
    throw new Error("Not signed in, or no organization selected.");
  }
  if (!has({ role: "org:admin" })) {
    throw new Error("Only an organization admin can do this.");
  }

  try {
    const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
    const existing = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, org.id), eq(memberships.clerkUserId, userId)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(memberships).values({ orgId: org.id, clerkUserId: userId, role: "admin" });
    }
  } catch {
    // Never let membership-mirroring get in the way of the actual admin
    // action this function is gating — same "log and continue" posture as
    // the rest of this codebase's non-critical side effects.
  }

  return { userId, clerkOrgId, orgSlug, getToken };
}
