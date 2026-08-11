import { enforce } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { KNOWN_TOOLS } from "@foundry/shared-types";
import type { BeforeToolCallHook } from "@foundry/agent-runtime-core";

const OPS_MANAGER_RISK_CLASS = new Map(KNOWN_TOOLS["ops-manager"].map((t) => [t.name, t]));

/**
 * The new runtime's `beforeToolCall` hook, wired straight to guardrails'
 * enforce() — same riskClass/approval-request/activity-log behavior eve's
 * `approval` policy gave gated tools, just invoked from our own loop
 * instead of eve's. A tool not registered as `gated: true` in
 * KNOWN_TOOLS["ops-manager"] (e.g. the pure reads) skips enforce()
 * entirely, same convention as today — those already call
 * `assertNotKilled` inside their own `execute()`.
 *
 * "require_approval" is mapped to a block for now: it still creates the
 * approval_requests row and logs to activity_log exactly like production,
 * but there is no resume-from-approval flow in this Phase 0 proof — a
 * parked call just stays blocked for this run. Real resumability is later
 * work, named explicitly as a gap.
 */
export function makeGuardrailsBeforeToolCall(input: { orgId: string; agentRunId: string }): BeforeToolCallHook {
  return async (toolCall) => {
    const known = OPS_MANAGER_RISK_CLASS.get(toolCall.name);
    if (!known || !known.gated) {
      return { block: false };
    }

    const result = await enforce(
      { orgId: input.orgId, department: "ops-manager", agentRunId: input.agentRunId },
      { name: toolCall.name, input: toolCall.input, riskClass: known.riskClass },
      dbDeps,
    );

    switch (result.verdict) {
      case "allow":
        return { block: false };
      case "deny":
        return { block: true, reason: result.reason };
      case "require_approval":
        return {
          block: true,
          reason: `parked for human approval (approvalRequestId=${result.approvalRequestId}) — resume-from-approval isn't built yet in this runtime`,
        };
    }
  };
}
