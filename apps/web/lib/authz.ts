import { auth } from "@clerk/nextjs/server";

/**
 * Throws unless the caller is an admin of the org attached to the current
 * session. Every server action that mutates something with real
 * consequence — resolving an approval, changing a department's autonomy
 * level or budget caps — must call this before touching the database.
 * Being signed in and having an org selected is not sufficient on its own;
 * any org member could otherwise approve spend or flip a department to
 * `bounded_autonomous`.
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

  return { userId, clerkOrgId, orgSlug, getToken };
}
