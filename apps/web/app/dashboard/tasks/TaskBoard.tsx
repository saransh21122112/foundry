"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { startTask, sendFollowUp, listTasks } from "./actions";

interface LogEntry {
  kind: "you" | "system" | "agent" | "pending" | "tool" | "reasoning" | "step";
  text: string;
  /** Only rendered when the Verbose toggle is on — see emitFromEvent. */
  verboseOnly?: boolean;
  /** Subagent nesting depth, for indenting verbose output. 0 = top level. */
  depth?: number;
}

/**
 * Tools worth showing as "an action happened" lines — mirrors
 * apps/agent-runtime/agent/lib/log-tool-result.ts's SKIP_TOOL_NAMES so the
 * transcript doesn't get noisy with pure reads/bookkeeping (read_file, glob,
 * todo, etc.) that Activity itself doesn't log either.
 */
const SKIP_TOOL_NAMES = new Set(["read_file", "glob", "grep", "todo", "agent", "load_skill", "ask_question"]);

/** `{ saved: true, path }` (save_project_file's own shape) → "saved <path>"; falls back to a generic label. */
function summarizeToolOutput(output: unknown): string {
  if (output && typeof output === "object" && typeof (output as Record<string, unknown>).path === "string") {
    return `saved ${(output as Record<string, unknown>).path}`;
  }
  return "done";
}

interface Task {
  id: string;
  title: string;
  createdAt: Date;
}

/** One line of eve's NDJSON event stream — see lib/eve-client.ts for the fuller version. */
interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
}

/**
 * One pending input request from an `input.requested` event — see
 * node_modules/eve/dist/src/runtime/input/types.d.ts. Only the field this
 * file actually reads is declared here, same hand-rolled convention as
 * EveEvent above.
 */
interface EveInputRequest {
  action?: { toolName?: string };
}

/**
 * eve emits `input.requested` for two unrelated things: a real
 * guardrails-gated tool approval, and eve's own built-in `ask_question`
 * tool (a plain conversational pause, nothing to do with guardrails).
 * `action.toolName === "ask_question"` is the only discriminator eve's
 * types expose — there's no separate "kind" field.
 */
type PendingKind = "approval" | "question" | null;

function pendingKindFrom(requests: readonly EveInputRequest[] | undefined): PendingKind {
  if (!requests || requests.length === 0) return null;
  return requests.every((r) => r.action?.toolName === "ask_question") ? "question" : "approval";
}

/**
 * Handles one stream event for the transcript. Recurses into
 * `subagent.event` (eve tunnels a delegated subagent's own event stream
 * under this wrapper — see node_modules/eve/dist/src/protocol/message.d.ts's
 * SubagentChildEventStreamEvent) so a nested subagent's own tool calls (e.g.
 * swe-lead delegating to frontend-developer, which is where
 * save_project_file actually runs) show up too, not just the top-level
 * "Delegating to X…" line. `subagentPath` accumulates the chain of names
 * for that recursion so a two-levels-deep call reads
 * "swe-lead > frontend-developer called save_project_file → saved …".
 */
function emitFromEvent(
  event: EveEvent,
  subagentPath: readonly string[],
  onEntry: (entry: LogEntry) => void,
  onPending: (kind: PendingKind) => void,
  onWaiting: (continuationToken: string) => void,
): void {
  const depth = subagentPath.length;
  if (event.type === "message.received") {
    const text = event.data?.message as string | undefined;
    if (text) onEntry({ kind: "you", text });
  } else if (event.type === "subagent.called") {
    onEntry({ kind: "system", text: `Delegating to ${event.data?.name as string}…`, depth });
  } else if (event.type === "subagent.event") {
    const childEvent = event.data?.event as EveEvent | undefined;
    const subagentName = event.data?.subagentName as string | undefined;
    if (childEvent) {
      emitFromEvent(childEvent, subagentName ? [...subagentPath, subagentName] : subagentPath, onEntry, onPending, onWaiting);
    }
  } else if (event.type === "actions.requested") {
    // Verbose-only: shows a call was requested *before* it executes —
    // action.result (below) covers the same call once it's actually done,
    // so this is purely "what's about to happen" detail.
    const actions = event.data?.actions as readonly { kind?: string; toolName?: string; name?: string }[] | undefined;
    const label = subagentPath.length > 0 ? `${subagentPath.join(" > ")} requesting` : "Requesting";
    for (const action of actions ?? []) {
      if (action.kind === "tool-call" && action.toolName) {
        onEntry({ kind: "step", text: `${label} ${action.toolName}…`, verboseOnly: true, depth });
      } else if (action.kind === "subagent-call" && action.name) {
        onEntry({ kind: "step", text: `${label} subagent ${action.name}…`, verboseOnly: true, depth });
      } else if (action.kind === "load-skill" && action.name) {
        onEntry({ kind: "step", text: `${label} skill ${action.name}…`, verboseOnly: true, depth });
      }
    }
  } else if (event.type === "action.result") {
    const result = event.data?.result as { kind?: string; toolName?: string; output?: unknown } | undefined;
    const status = event.data?.status as string | undefined;
    if (result?.kind === "tool-result" && result.toolName) {
      const skipped = SKIP_TOOL_NAMES.has(result.toolName);
      const label = subagentPath.length > 0 ? `${subagentPath.join(" > ")} called` : "Called";
      if (status === "completed") {
        onEntry({ kind: "tool", text: `${label} ${result.toolName} → ${summarizeToolOutput(result.output)}`, verboseOnly: skipped, depth });
      } else if (status === "rejected" || status === "failed") {
        const error = event.data?.error as { message?: string } | undefined;
        onEntry({
          kind: "system",
          text: `${result.toolName} was blocked: ${error?.message ?? (status === "rejected" ? "denied by guardrails" : "failed")}`,
          depth,
        });
      }
    }
  } else if (event.type === "reasoning.completed") {
    // One line per completed reasoning block — not per `reasoning.appended`
    // delta, which would be several lines of noise per turn for the same
    // thought as it streams in. `reasoning.completed` already carries the
    // full block, so the deltas add nothing a verbose reader needs.
    const text = event.data?.reasoning as string | undefined;
    if (text) onEntry({ kind: "reasoning", text, verboseOnly: true, depth });
  } else if (event.type === "step.started" || event.type === "turn.started") {
    const label = event.type === "turn.started" ? "Turn" : "Step";
    const index = event.data?.stepIndex as number | undefined;
    onEntry({ kind: "step", text: `${label} started${index !== undefined ? ` (step ${index + 1})` : ""}`, verboseOnly: true, depth });
  } else if (event.type === "message.completed") {
    const text = event.data?.message as string | undefined;
    if (text) onEntry({ kind: "agent", text });
  } else if (event.type === "input.requested") {
    const requests = event.data?.requests as readonly EveInputRequest[] | undefined;
    const kind = pendingKindFrom(requests);
    onPending(kind);
    onEntry({
      kind: "pending",
      text:
        kind === "question"
          ? "Paused — waiting for your answer to keep this going."
          : "Paused — this needs your approval before it can go further.",
    });
  } else if (event.type === "step.failed" || event.type === "turn.failed" || event.type === "session.failed") {
    const failMessage = (event.data as { message?: string } | undefined)?.message;
    onEntry({ kind: "system", text: `Something went wrong: ${failMessage ?? event.type}` });
  } else if (event.type === "session.waiting") {
    const token = event.data?.continuationToken as string | undefined;
    if (token) onWaiting(token);
  }
}

const LAST_SESSION_KEY = "foundry:lastRunSession";

// How long a post-reply replay waits for the agent runtime to actually
// resume before giving up and telling the user something might be stuck —
// see replayTranscript's timeoutMs param. Only applied to reply-triggered
// replays; the initial page-load replay has no ceiling since a long task
// running for a while is normal, not a stall.
const REPLY_STALL_TIMEOUT_MS = 25_000;

/**
 * Thrown by replayTranscript when timeoutMs elapses without reaching a
 * genuine (post-minRestingIndex) resting point. A distinct type so
 * runReplay's catch can tell "the runtime may not have picked this up"
 * apart from a real fetch/network error, which gets the ordinary loadError
 * treatment instead.
 */
class ReplyStallTimeoutError extends Error {}

/** "3m ago" / "5h ago" / a date once it's more than a day old — for the task list. */
function relativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Replays a session's full event history into a transcript, via repeated
 * bounded "catch up to the current tail" reads (`includeTailIndex=1`) rather
 * than one long-lived connection. Two reasons a single live read (the
 * original approach) doesn't work here:
 *
 * 1. eve's stream never closes on its own — see lib/eve-client.ts's header
 *    comment — so something has to decide when to stop reading.
 * 2. `session.waiting` is NOT a one-time terminal event for a session
 *    that's been resumed before: replaying from the top after a follow-up
 *    walks straight into the OLD (already-answered) `session.waiting` that
 *    sits earlier in history. Stopping there — which the original "stop at
 *    the first terminal-looking event" logic did — means the reply's real
 *    effects (the events recorded after it) never get read at all.
 *
 * Bounded reads sidestep both: each round reads only up to whatever eve
 * had recorded as of that request, so "waiting" only ever gets treated as
 * the current state when it's genuinely the last thing on the tail. If the
 * tail isn't a resting point yet (the turn is still actively running),
 * poll again a moment later instead of holding one connection open.
 *
 * `shouldStop` is checked between polls so that switching to a different
 * task (see the session manager below) actually stops this loop instead of
 * leaving it polling a task nobody's looking at anymore — with multiple
 * tasks now switchable, an orphaned loop per abandoned task is exactly the
 * kind of accumulation that left eve's dev server with 11 stacked stream
 * listeners on one session during testing (2026-08-01).
 */
async function replayTranscript(
  sessionId: string,
  onEntry: (entry: LogEntry) => void,
  onPending: (kind: PendingKind) => void,
  onWaiting: (continuationToken: string) => void,
  shouldStop: () => boolean,
  // A resting point (session.waiting/completed/failed) only counts as the
  // real outcome once the tail has advanced past this index. Without this,
  // a replay started right after sending a reply can race the agent
  // runtime's async processing of that reply: the very first fetch can
  // land before eve has recorded anything new, see the SAME old
  // session.waiting event still sitting at the tail, and correctly-but-
  // wrongly treat that stale state as "done" — the reply silently appears
  // to do nothing. Pass the previous cursor here to force at least one
  // more poll until real new events show up.
  minRestingIndex = 0,
  // See ReplyStallTimeoutError and REPLY_STALL_TIMEOUT_MS above — undefined
  // (the default) means poll indefinitely, used for the initial page-load
  // replay where there's no "this should have happened by now" ceiling.
  timeoutMs?: number,
): Promise<number> {
  let cursor = 0;
  const startedAt = Date.now();

  while (!shouldStop()) {
    if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
      throw new ReplyStallTimeoutError("Timed out waiting for the agent runtime to resume.");
    }
    const res = await fetch(`/api/agent-stream/${sessionId}?startIndex=${cursor}&includeTailIndex=1`);
    if (!res.ok || !res.body) {
      throw new Error(`Couldn't reach the agent runtime (${res.status}). Is it running?`);
    }
    const tailIndexHeader = res.headers.get("x-eve-stream-tail-index");
    const tailIndex = tailIndexHeader !== null ? Number(tailIndexHeader) : null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let index = cursor - 1;
    let reachedRestingPoint = false;

    caughtUp: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        index++;

        const event = JSON.parse(line) as EveEvent;
        emitFromEvent(event, [], onEntry, onPending, onWaiting);

        if (
          (event.type === "session.completed" || event.type === "session.failed" || event.type === "session.waiting") &&
          index >= minRestingIndex
        ) {
          reachedRestingPoint = true;
        }

        if (tailIndex !== null && index >= tailIndex) break caughtUp;
      }
    }
    reader.cancel().catch(() => {});
    cursor = index + 1;

    // reachedRestingPoint can only have been set by an event at/after
    // minRestingIndex, so it's genuinely current, not a stale resting point
    // left over from before this replay started (see minRestingIndex's doc).
    if (reachedRestingPoint) return cursor;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return cursor;
}

export function TaskBoard({ initialTasks }: { initialTasks: Task[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session");

  const [message, setMessage] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set when a post-reply replay hits REPLY_STALL_TIMEOUT_MS without the
  // agent runtime resuming — see ReplyStallTimeoutError.
  const [replyStalled, setReplyStalled] = useState(false);
  // Verbose transcript toggle — see LogEntry.verboseOnly / emitFromEvent.
  // Default off: today's filtered "chat" view stays the default experience.
  const [verbose, setVerbose] = useState(false);
  // Seeded from the server render (page.tsx) — no client fetch needed just
  // to show the list on first paint; refreshTasks() below only re-fetches
  // after something actually changes the list (a new task started).
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  // Which session the currently-in-flight replay loop belongs to. Switching
  // tasks updates this before starting the new replay, so the OLD loop's
  // `shouldStop` check (compared against this ref, not a stale closure
  // value) sees the mismatch on its next poll and stops itself — see
  // replayTranscript's header comment for why an orphaned loop matters.
  const activeSessionRef = useRef<string | null>(null);
  // Cursor (event count) as of the end of the last completed replay — see
  // handleReply's use of this as minRestingIndex on the post-reply replay.
  const lastCursorRef = useRef(0);
  // The token+message of the most recent reply attempt, kept independent of
  // component state (which runReplay resets on every call) so "Try again"
  // can resend the exact same pair after a stall.
  const lastReplyRef = useRef<{ token: string; message: string } | null>(null);

  const refreshTasks = useCallback(() => {
    listTasks().then(setTasks).catch(() => {});
  }, []);

  const runReplay = useCallback(async (sessionId: string, minRestingIndex = 0, timeoutMs?: number) => {
    activeSessionRef.current = sessionId;
    setLog([]);
    setPendingKind(null);
    setContinuationToken(null);
    setLoadError(null);
    setReplyStalled(false);
    setRunning(true);
    try {
      const cursor = await replayTranscript(
        sessionId,
        (entry) => setLog((l) => [...l, entry]),
        (kind) => setPendingKind(kind),
        (token) => setContinuationToken(token),
        () => activeSessionRef.current !== sessionId,
        minRestingIndex,
        timeoutMs,
      );
      if (activeSessionRef.current === sessionId) lastCursorRef.current = cursor;
    } catch (err) {
      if (activeSessionRef.current !== sessionId) {
        // stale loop for an abandoned session — don't surface its error
      } else if (err instanceof ReplyStallTimeoutError) {
        setReplyStalled(true);
      } else {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (activeSessionRef.current === sessionId) setRunning(false);
    }
  }, []);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || !continuationToken || !sessionIdFromUrl || sendingReply) return;
    setSendingReply(true);
    try {
      lastReplyRef.current = { token: continuationToken, message: reply };
      await sendFollowUp(sessionIdFromUrl, continuationToken, reply);
      setReply("");
      // Same event log, re-read from the top — the session's durable
      // history is the source of truth, so this stays correct even if the
      // reply answered a proxied subagent approval buried mid-transcript.
      // minRestingIndex forces the replay to keep polling until it sees a
      // resting point AFTER where we were before this reply, instead of
      // possibly racing the runtime and re-landing on the stale one.
      // timeoutMs bounds that wait — eve's delivery model is best-effort
      // (see ReplyStallTimeoutError), so an accepted reply isn't a
      // guarantee the runtime actually resumed.
      await runReplay(sessionIdFromUrl, lastCursorRef.current, REPLY_STALL_TIMEOUT_MS);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingReply(false);
    }
  }

  /**
   * Resends the exact same continuationToken+message after a stall. A
   * thrown error here means the resend itself was rejected (e.g. eve's
   * docs confirm a stale continuationToken is explicitly rejected) — the
   * likeliest read is the original reply actually did land, so this is
   * framed as "probably already worked," not a generic failure. A second
   * stall (runReplay times out again without throwing here, since it
   * catches its own ReplyStallTimeoutError internally) just re-shows the
   * same stalled callout.
   */
  async function handleRetryReply() {
    const pending = lastReplyRef.current;
    if (!pending || !sessionIdFromUrl || sendingReply) return;
    setSendingReply(true);
    try {
      await sendFollowUp(sessionIdFromUrl, pending.token, pending.message);
      await runReplay(sessionIdFromUrl, lastCursorRef.current, REPLY_STALL_TIMEOUT_MS);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setReplyStalled(false);
      setLoadError(`Looks like your reply may already have gone through — check the transcript above. (${detail})`);
    } finally {
      setSendingReply(false);
    }
  }

  // Reloading /dashboard/tasks?session=... (back button, refresh, bookmark)
  // replays that session's real history instead of showing an empty page.
  // Also remembered in localStorage: clicking the sidebar's plain "Run a
  // task" link (no session in the URL at all) redirects to the last one
  // instead of looking like nothing ever ran — this is the exact gap that
  // made a real completed task look lost after just navigating away.
  useEffect(() => {
    if (sessionIdFromUrl) {
      runReplay(sessionIdFromUrl);
      localStorage.setItem(LAST_SESSION_KEY, sessionIdFromUrl);
    } else {
      const last = localStorage.getItem(LAST_SESSION_KEY);
      if (last) router.replace(`/dashboard/tasks?session=${last}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdFromUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || running) return;
    try {
      const { sessionId } = await startTask(message);
      setMessage("");
      refreshTasks();
      // Triggers the useEffect above (sessionIdFromUrl changes) to do the
      // actual replay — don't also call runReplay() here, or the same
      // session gets read twice and every entry shows up doubled.
      router.replace(`/dashboard/tasks?session=${sessionId}`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  function startNew() {
    localStorage.removeItem(LAST_SESSION_KEY);
    activeSessionRef.current = null;
    setMessage("");
    setLog([]);
    setPendingKind(null);
    setContinuationToken(null);
    router.replace("/dashboard/tasks");
  }

  return (
    <main className="run-layout">
      <div className="run-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow">Give your company something to do</p>
            <h1>Delegate a task</h1>
          </div>
          {sessionIdFromUrl && (
            <button type="button" className="btn" onClick={startNew}>
              Start a new task
            </button>
          )}
        </div>
        <p className="lede">
          Say what you want done — the root agent reads it and decides which
          department(s) handle it. Watch below as it works. Departments that
          aren&apos;t turned on (see <Link href="/dashboard/departments">Departments</Link>) can&apos;t do anything, so turn
          at least one on before trying this. A department without any real
          tools wired up yet can still reply and scratch out work in its own
          sandbox, but it can&apos;t reach anything outside that sandbox — no
          real email, no real deploys — until that gets built for it. Nothing
          it does there shows up in the Activity log, since that only records
          actions that pass through the guardrail system. Want a real shell
          instead of a chat? See <Link href="/dashboard/run">Run a task</Link>.
        </p>

        <form onSubmit={handleSubmit} className="panel">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Research two competitors for our product and draft a cold email mentioning what you found"
            rows={3}
            required
          />
          <div style={{ marginTop: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={running}>
              {running ? "Running…" : "Run"}
            </button>
          </div>
        </form>

        {loadError && (
          <div className="callout" style={{ borderColor: "var(--ember-hot)" }}>
            {loadError}
          </div>
        )}
        {pendingKind === "approval" && (
          <div className="callout">
            This task is paused, waiting on you — reply below (e.g. &quot;approve&quot; or
            &quot;deny&quot;), or use the{" "}
            <Link href="/dashboard/approvals">Approval queue →</Link>
          </div>
        )}
        {pendingKind === "question" && (
          <div className="callout">
            Waiting for your answer — reply below to keep this task going.
          </div>
        )}
        {replyStalled && (
          <div className="callout" style={{ borderColor: "var(--ember-hot)" }}>
            <p style={{ margin: "0 0 10px" }}>
              Your reply was received, but the agent hasn&apos;t resumed yet — this can happen if it landed between
              processing steps. Try sending it again, or wait a bit longer and reload.
            </p>
            <button type="button" className="btn" onClick={handleRetryReply} disabled={sendingReply}>
              {sendingReply ? "Sending…" : "Try again"}
            </button>
          </div>
        )}

        <div className="panel">
          {log.length === 0 && !running && <p className="panel-empty">Nothing run yet.</p>}
          {log.length > 0 && (
            <>
              <label className="verbose-toggle mono">
                <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
                Verbose — show reasoning, step/turn markers, and every tool call
              </label>
              <div className="transcript">
                {log
                  .filter((entry) => verbose || !entry.verboseOnly)
                  .map((entry, i) => (
                    <div
                      key={i}
                      className={`transcript-entry-${entry.kind}${entry.verboseOnly ? " transcript-entry-verbose" : ""}`}
                      style={{ marginLeft: (entry.depth ?? 0) * 16 }}
                    >
                      <span className="transcript-label">
                        {entry.kind === "you"
                          ? "You"
                          : entry.kind === "agent"
                            ? "Foundry"
                            : entry.kind === "pending"
                              ? "Paused"
                              : entry.kind === "tool"
                                ? "Action"
                                : entry.kind === "reasoning"
                                  ? "Thinking"
                                  : entry.kind === "step"
                                    ? "Step"
                                    : "System"}
                      </span>
                      <p className="transcript-body">{entry.text}</p>
                    </div>
                  ))}
              </div>
            </>
          )}
          {running && (
            <div style={{ marginTop: log.length > 0 ? 14 : 0 }}>
              <span className="pulse-dot" /> <span className="mono" style={{ fontSize: 12, color: "var(--iron)" }}>working…</span>
            </div>
          )}
        </div>

        {continuationToken && !running && (
          <form onSubmit={handleReply} className="panel" style={{ marginTop: 14 }}>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to keep this task going…"
              rows={2}
              required
            />
            <div style={{ marginTop: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={sendingReply}>
                {sendingReply ? "Sending…" : "Reply"}
              </button>
            </div>
          </form>
        )}
      </div>

      <aside className="task-sidebar">
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Your tasks {tasks.length > 0 && `(${tasks.length})`}
        </p>
        {tasks.length === 0 && <p className="panel-empty" style={{ padding: "8px 0" }}>None yet.</p>}
        {tasks.length > 0 && (
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={`task-list-item${task.id === sessionIdFromUrl ? " active" : ""}`}
                  onClick={() => router.replace(`/dashboard/tasks?session=${task.id}`)}
                  title={task.title}
                >
                  <span className="task-list-title">{task.title}</span>
                  <span className="task-list-time mono">{relativeTime(new Date(task.createdAt))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}
