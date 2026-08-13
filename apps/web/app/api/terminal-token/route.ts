import { auth } from "@clerk/nextjs/server";

/**
 * Mints a session id + short-lived token for the real live terminal
 * (node-pty over WebSocket, see runtime-core/server.ts). The session id is
 * derived from the org id AND the signed-in user id, not randomly
 * generated — one persistent shell per PERSON, not per org and not per
 * browser tab/mount. Per-org (not per-person) was the first pass, but that
 * meant every admin in the org shared one $HOME — so one admin running
 * `claude login` for their own personal account signed in for everyone
 * else sharing that shell too, and the next person to run it would just
 * clobber it again. Per-person keeps the same "survives a tab switch"
 * property (see runtime-core's own comment) while giving each admin their
 * own $HOME to run their own personal login in. Still generated
 * server-side, after Clerk auth, so the calling user never gets to choose
 * (and therefore never gets to guess or collide with) another user's
 * terminal id.
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
  const { orgId: clerkOrgId, userId, has } = await auth();
  if (!clerkOrgId) return new Response("Select or create an organization first.", { status: 401 });
  if (!userId) return new Response("Sign in first.", { status: 401 });
  if (!has({ role: "org:admin" })) return new Response("Only an organization admin can open a live terminal.", { status: 403 });

  // "term-" prefix + "org:user" shape: runtime-core parses both back out to
  // pick this person's own persistent home directory on the EFS volume
  // (see spawnTerminal/terminalHomeDir in runtime-core/server.ts). ":" is
  // safe as a separator — Clerk ids are alnum/underscore only.
  const sessionId = `term-${clerkOrgId}:${userId}`;

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
