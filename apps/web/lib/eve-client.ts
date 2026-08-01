/**
 * Minimal client for the agent-runtime's HTTP session API — just enough
 * to resume a session parked on a human-in-the-loop approval. Written
 * against node_modules/eve/docs and verified live against a real eve dev
 * session with a real gated tool call.
 *
 * `GET .../stream` never closes its HTTP connection on its own, even for a
 * bounded "catch-up" read (`includeTailIndex=1`) — the docs' "read until it
 * passes that tail, then disconnect" means the CLIENT must stop reading
 * once it has consumed up to `x-eve-stream-tail-index`. `await res.text()`
 * waits for the connection to close and hangs forever. Read the body
 * incrementally and stop once caught up.
 *
 * Resolving via a full history rescan for the STRUCTURED `inputResponses`
 * form (`{requestId, optionId}`) was tried first and looked right against
 * the docs, but broke silently in practice (2026-08-01): the DB recorded
 * "approved", the resume POST returned 200, and the parked session just...
 * never continued, for a subagent-delegated tool call specifically —
 * confirmed by leaving it several minutes with zero new activity_log rows
 * and zero new agent-runtime log lines. A plain "approve"/"deny" text
 * follow-up against the *latest* continuationToken (the same mechanism the
 * Run page's own chat-reply box uses, which resolved the very same kind of
 * proxied approval correctly, twice, live) does not have this problem —
 * per the docs, plain text that matches an option label resolves the
 * pending request the same way structured input does, without needing to
 * separately track a `requestId` at all. Use the tail read (`startIndex=-1`)
 * rather than a full rescan from 0 for the same reason the chat box doesn't
 * rescan: the tail is unambiguous, a full-history scan of an already-
 * multi-turn session is not.
 */

function agentRuntimeUrl() {
  const url = process.env.AGENT_RUNTIME_URL;
  if (!url) {
    throw new Error(
      "AGENT_RUNTIME_URL is not set — point it at the running eve agent-runtime (e.g. http://localhost:2000 in dev).",
    );
  }
  return url.replace(/\/$/, "");
}

interface EveStreamEvent {
  type: string;
  data?: {
    continuationToken?: string;
    [key: string]: unknown;
  };
}

/**
 * Reads just the latest recorded event for a session (`startIndex=-1`,
 * bounded to the current tail) to recover its current `continuationToken`
 * — normally on `session.waiting`. Stops reading once caught up rather
 * than waiting for the connection to close (see file header).
 */
async function fetchLatestContinuationToken(sessionId: string, bearerToken: string): Promise<string> {
  const res = await fetch(
    `${agentRuntimeUrl()}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=-1&includeTailIndex=1`,
    { headers: { authorization: `Bearer ${bearerToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Failed to read session stream: ${res.status} ${await res.text()}`);
  }
  if (!res.body) throw new Error(`Session ${sessionId}'s stream response had no body.`);

  const tailIndexHeader = res.headers.get("x-eve-stream-tail-index");
  const tailIndex = tailIndexHeader !== null ? Number(tailIndexHeader) : null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let continuationToken: string | undefined;
  let index = -1;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        index++;

        const event = JSON.parse(line) as EveStreamEvent;
        if (event.data?.continuationToken) continuationToken = event.data.continuationToken;

        if (tailIndex !== null && index >= tailIndex) break outer;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (!continuationToken) {
    throw new Error(`Session ${sessionId} has no current continuationToken to resume with.`);
  }
  return continuationToken;
}

/**
 * Resumes a session parked on a human-in-the-loop approval, by sending a
 * plain "approve"/"deny" follow-up against the session's current
 * continuationToken — see file header for why this replaced the earlier
 * structured-`inputResponses` + full-history-rescan approach.
 *
 * `bearerToken` should be the resolving admin's own Clerk session token
 * (see requireOrgAdmin + auth().getToken() in the calling action) — the
 * agent-runtime re-evaluates tenant auth from THIS request when it
 * resumes (confirmed live: resuming with no token re-hit
 * `no_org_on_session` inside the tool, even though the original request
 * had a valid org). There's no separate service-to-service credential.
 */
export async function resumeEveApproval(
  sessionId: string,
  decision: "approved" | "rejected",
  bearerToken: string,
): Promise<void> {
  const continuationToken = await fetchLatestContinuationToken(sessionId, bearerToken);
  const message = decision === "approved" ? "approve" : "deny";

  const res = await fetch(`${agentRuntimeUrl()}/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ continuationToken, message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to resume session ${sessionId}: ${res.status} ${await res.text()}`);
  }
}
