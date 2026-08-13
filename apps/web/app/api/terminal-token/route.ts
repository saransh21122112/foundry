import { auth } from "@clerk/nextjs/server";

/**
 * Mints a session id + short-lived token for the real live terminal
 * (node-pty over WebSocket, see runtime-core/server.ts). The session id is
 * derived from the org id, not randomly generated — one persistent shell
 * per org, not one per browser tab/mount. That's what lets switching tabs
 * (or closing and reopening this page) reattach to the SAME running shell
 * instead of getting a blank one: runtime-core keys its PTY map by this id
 * and no longer kills the PTY when a socket disconnects, only on a long
 * idle timeout. Still generated server-side, after Clerk auth, so the
 * calling user never gets to choose (and therefore never gets to guess or
 * collide with) another org's terminal id.
 *
 * The long-lived RUNTIME_CORE_INTERNAL_TOKEN never reaches client-side JS —
 * only this narrow, expiring, session-id-bound token does.
 *
 * Restricted to org admins (same `has({ role: "org:admin" })` check as
 * dashboard/compliance) — a real, ungated host shell is a much bigger
 * grant than anything else an ordinary org member can do in this app, so
 * this is not just "signed in with an org selected" like the other
 * per-org routes. Flagged by automated security review; this is the fix,
 * not a dismissal — an unrestricted version really would let any invited
 * member of the org run arbitrary commands on the shared host.
 */
export async function GET() {
  const { orgId: clerkOrgId, has } = await auth();
  if (!clerkOrgId) return new Response("Select or create an organization first.", { status: 401 });
  if (!has({ role: "org:admin" })) return new Response("Only an organization admin can open a live terminal.", { status: 403 });

  // "term-" prefix: runtime-core strips it to recover the org id, which it
  // needs to pick this org's persistent home directory on the EFS volume
  // (see spawnTerminal in runtime-core/server.ts).
  const sessionId = `term-${clerkOrgId}`;

  const res = await fetch(`${process.env.AGENT_RUNTIME_URL}/runtime-core/v1/terminal-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RUNTIME_CORE_INTERNAL_TOKEN}`,
    },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) return new Response("Could not mint terminal token.", { status: 502 });

  const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
  return Response.json({ sessionId, token, expiresAt });
}
