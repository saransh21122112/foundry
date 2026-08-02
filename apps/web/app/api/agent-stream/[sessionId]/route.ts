import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db, ensureOrganization, runSessions } from "@foundry/db";

/**
 * Proxies the agent-runtime's session event stream to the browser. True
 * passthrough — returns eve's own ReadableStream directly as the response
 * body instead of buffering it server-side, so the client sees events as
 * they arrive rather than all at once. (A buffered version of this exact
 * route was used repeatedly during Phase 1 verification and worked, but
 * only gave an all-at-once result; this is the real, live version.)
 *
 * `signal: request.signal` matters more than it looks: this is a two-hop
 * proxy (browser -> this route -> eve). The client cancelling its reader
 * only tears down the browser-to-us leg; nothing told the us-to-eve fetch
 * to stop unless we wire the same abort signal through. Confirmed live
 * (2026-08-01) without this: eve's dev server accumulated 11 stacked
 * stream listeners on one session from repeated polling reads that never
 * got told to close on their far end, which degraded that session's own
 * turn processing. Every polling read the Run page's replay does (one per
 * ~700ms while a task is active) is exactly the kind of load this would
 * compound under real usage, not just repeated manual testing — so this
 * isn't optional cleanup, it's what makes polling-based replay safe to run
 * continuously in production.
 *
 * The `run_sessions` ownership check below matters just as much: `sessionId`
 * is a client-supplied URL segment, and eve authenticates the caller but has
 * no idea which org owns a given session id (that ACL is explicitly the
 * application's job per eve's own multi-tenant-auth docs). Without this
 * check, any signed-in member of ANY org who learned another org's session
 * id could read that org's entire live transcript. Found by a live
 * isolation audit (2026-08-02) — confirmed missing, fixed here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { getToken, orgId: clerkOrgId, orgSlug } = await auth();
  const token = await getToken();
  if (!token) return new Response("Not signed in.", { status: 401 });
  if (!clerkOrgId) return new Response("Select or create an organization first.", { status: 401 });

  const { sessionId } = await params;

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [owned] = await db
    .select({ id: runSessions.id })
    .from(runSessions)
    .where(and(eq(runSessions.id, sessionId), eq(runSessions.orgId, org.id)))
    .limit(1);
  if (!owned) return new Response("Session not found.", { status: 404 });

  const { search } = new URL(request.url);
  const res = await fetch(`${process.env.AGENT_RUNTIME_URL}/eve/v1/session/${sessionId}/stream${search}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: request.signal,
  });

  const headers: Record<string, string> = { "content-type": "application/x-ndjson" };
  const tailIndex = res.headers.get("x-eve-stream-tail-index");
  if (tailIndex !== null) headers["x-eve-stream-tail-index"] = tailIndex;

  return new Response(res.body, { status: res.status, headers });
}
