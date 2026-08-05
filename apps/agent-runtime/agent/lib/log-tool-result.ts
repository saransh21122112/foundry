import type { HookEventMap, HookContext } from "eve/hooks";
import { dbDeps } from "@foundry/guardrails/deps-db";
import type { GuardrailDeps } from "@foundry/guardrails";
import { DEPARTMENTS, type Department } from "@foundry/shared-types";

/**
 * eve built-ins with no side effect worth surfacing to a business owner on
 * /dashboard/activity — a pure read (read_file/glob/grep), bookkeeping
 * (todo), plain delegation (agent) or context-loading (load_skill), or a
 * conversational pause (ask_question, which produces its own
 * input.requested pause rather than anything worth logging as a tool
 * outcome). Everything else — eve's remaining side-effecting built-ins
 * (bash, write_file, web_fetch, web_search, connection_search) and every
 * Foundry-authored tool — gets logged. One-line, adjustable default, not a
 * hard rule; see the plan doc for the full reasoning.
 */
const SKIP_TOOL_NAMES = new Set([
  "read_file",
  "glob",
  "grep",
  "todo",
  "agent",
  "load_skill",
  "ask_question",
]);

/**
 * Nested delegate subagents whose own directory name doesn't equal a
 * Department (every top-level subagent dir already does, 1:1). Maps each
 * to the department its activity should be attributed to; agentNodeId
 * carries the finer-grained "<department>/<agentName>" for display.
 */
const PARENT_DEPARTMENT: Record<string, Department> = {
  "code-reviewer": "eng-lead",
  "backend-developer": "swe-lead",
  "frontend-developer": "swe-lead",
  "ui-ux-designer": "swe-lead",
};

const DEPARTMENT_SET = new Set<string>(DEPARTMENTS);

/**
 * Shared `action.result` hook handler, registered verbatim by a 2-line
 * hook file in every one of the 13 agent/subagent directories (subagent
 * hooks only fire in their own scope — see eve's hooks docs — so there's
 * no single registration point that covers all of them).
 *
 * Closes the gap `enforce()`'s opt-in logging leaves: this fires for
 * every real tool result, built-in or Foundry-authored alike, whether or
 * not the tool ever went through `makeApprovalPolicy()`.
 */
export async function logToolResult(
  event: HookEventMap["action.result"],
  ctx: HookContext,
  deps: Pick<GuardrailDeps, "logActivity"> = dbDeps,
): Promise<void> {
  const { result, status, error } = event.data;
  if (result.kind !== "tool-result") return; // subagent-result / load-skill-result aren't tool calls
  if (status === "rejected") return; // enforce()'s requireApproval() already logs tool_call_blocked for this
  if (SKIP_TOOL_NAMES.has(result.toolName)) return;

  const orgId = ctx.session.auth.current?.attributes?.orgId;
  if (typeof orgId !== "string") return; // no org resolved on this session — nothing to attribute the row to

  const agentName = ctx.agent.name;
  const parentDepartment = PARENT_DEPARTMENT[agentName];
  const department = parentDepartment ?? (DEPARTMENT_SET.has(agentName) ? (agentName as Department) : undefined);
  if (!department) return; // root orchestrator's own name isn't a Department — nothing to attribute this to yet
  const agentNodeId = parentDepartment ? `${parentDepartment}/${agentName}` : undefined;

  const agentRunId = ctx.session.parent?.rootSessionId ?? ctx.session.id;

  // ponytail: toolInput isn't available here (it's on the earlier,
  // separately-correlated actions.requested event; joining it means real
  // per-process state and a leak risk on a crashed turn) — fine for gated
  // tools (enforce()'s own tool_call_attempted row already has the input),
  // genuinely missing for ungated built-ins. Upgrade only if it causes
  // real confusion reading the Activity page.
  await deps.logActivity({
    orgId,
    department,
    agentRunId,
    eventType: status === "failed" ? "tool_call_failed" : "tool_call_executed",
    toolName: result.toolName,
    toolOutput: status === "failed" ? { error: error?.message ?? "unknown error", output: result.output } : result.output,
    agentNodeId,
  });
}

/**
 * `subagent.called` hook handler, registered alongside logToolResult in
 * every one of the 13 agent/subagent hook files. Closes the gap where a
 * task that's pure agent-to-agent delegation (no real tool call yet, which
 * is most departments today) never wrote a row anywhere — /dashboard/graph
 * only ever reads activity_log, so a run like that showed the calling
 * department as active on /dashboard/run's own live transcript while
 * appearing completely idle on graph. `subagent_delegated` is deliberately
 * excluded from /dashboard/activity's own query (see that page) — it's a
 * plain delegation, not a guardrails-relevant action, and Activity is
 * meant to stay a record of the latter only.
 *
 * `event.data.name` (NOT `subagentName` — that field belongs to the
 * sibling subagent.started/event/completed events, not this one; verified
 * against eve's own SubagentCalledStreamEvent type) is the called
 * subagent's name.
 */
export async function logSubagentDelegation(
  event: HookEventMap["subagent.called"],
  ctx: HookContext,
  deps: Pick<GuardrailDeps, "logActivity"> = dbDeps,
): Promise<void> {
  const orgId = ctx.session.auth.current?.attributes?.orgId;
  if (typeof orgId !== "string") return; // no org resolved on this session — nothing to attribute the row to

  const agentName = ctx.agent.name;
  const parentDepartment = PARENT_DEPARTMENT[agentName];
  const department = parentDepartment ?? (DEPARTMENT_SET.has(agentName) ? (agentName as Department) : undefined);
  if (!department) return; // root orchestrator's own name isn't a Department — nothing to attribute this to yet
  const agentNodeId = parentDepartment ? `${parentDepartment}/${agentName}` : undefined;

  const agentRunId = ctx.session.parent?.rootSessionId ?? ctx.session.id;

  await deps.logActivity({
    orgId,
    department,
    agentRunId,
    eventType: "subagent_delegated",
    toolName: event.data.name,
    agentNodeId,
  });
}
