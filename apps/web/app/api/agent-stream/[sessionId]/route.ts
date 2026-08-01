import { auth } from "@clerk/nextjs/server";

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
 */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return new Response("Not signed in.", { status: 401 });

  const { sessionId } = await params;
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
