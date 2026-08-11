import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";

/**
 * Mints a fresh session id + short-lived token for the real live terminal
 * (node-pty over WebSocket, see runtime-core/server.ts). Unlike
 * agent-stream's proxy route, there's no existing `run_sessions` row to
 * check ownership against — a terminal session isn't an eve task, it's
 * created fresh on demand, one PTY per browser tab (see runtime-core's own
 * comment on why reconnect isn't supported yet). So the session id is
 * generated HERE, server-side, after Clerk auth, rather than accepted from
 * the client — the calling user never gets to choose (and therefore never
 * gets to guess or collide with) another session's id.
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

  const sessionId = randomUUID();

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
