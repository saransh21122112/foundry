import type { AutonomyLevel, Department, RiskClass } from "@foundry/shared-types";
export type { AutonomyLevel, Department, RiskClass } from "@foundry/shared-types";

export interface ToolCall {
  name: string;
  input: unknown;
  /** Declared by the tool wrapper, not the model. */
  riskClass: RiskClass;
  /**
   * Best-effort cost estimate for this specific call, in the same unit as
   * the department's budget_caps row (e.g. usd, emails_sent). Required for
   * any tool that spends money or consumes a rate-limited resource; a tool
   * wrapper with no meaningful cost (e.g. a pure read) may omit it.
   */
  estimatedCost?: { unit: string; amount: number };
}

export interface EnforceContext {
  orgId: string;
  department: Department;
  agentRunId: string;
  /**
   * eve's own per-call id for this specific tool invocation
   * (ApprovalContext.callId). Stored on the approval_requests row so a
   * future "resolve from the dashboard" flow can actually resume the
   * parked eve session, not just flip our own audit record. Optional
   * because enforce()'s in-memory-fake unit tests don't have a real eve
   * session to draw one from.
   */
  eveCallId?: string;
}

export type EnforceResult =
  | { verdict: "allow" }
  | { verdict: "require_approval"; reason: string; approvalRequestId: string }
  | { verdict: "deny"; reason: string };

/**
 * Everything enforce() reads or writes, injected so the pipeline is
 * unit-testable with in-memory fakes and never needs a live database to
 * verify its own logic. packages/db provides the real implementation
 * (Phase 1, once Neon is provisioned).
 */
export interface GuardrailDeps {
  isKillSwitchActive(orgId: string, department: Department): Promise<boolean>;
  /**
   * The department's own on/off switch (`department_configs.enabled`),
   * checked before autonomy level. No row (department never configured by
   * the customer) defaults to `false` — a department has to be explicitly
   * turned on in the dashboard before it can do anything at all, not just
   * left to whatever `getAutonomyLevel()`'s own fallback happens to be.
   */
  isDepartmentEnabled(orgId: string, department: Department): Promise<boolean>;
  getAutonomyLevel(orgId: string, department: Department): Promise<AutonomyLevel>;
  isToolAllowed(orgId: string, department: Department, toolName: string): Promise<boolean>;
  /** Returns the new total if it would be allowed, or null if it would exceed the cap. */
  checkAndReserveBudget(
    orgId: string,
    department: Department,
    cost: { unit: string; amount: number } | undefined,
  ): Promise<{ withinBudget: boolean }>;
  checkRateLimit(orgId: string, department: Department, toolName: string): Promise<boolean>;
  createApprovalRequest(input: {
    orgId: string;
    department: Department;
    agentRunId: string;
    eveCallId?: string;
    toolName: string;
    toolInput: unknown;
    reason: string;
  }): Promise<{ id: string }>;
  logActivity(entry: {
    orgId: string;
    department: Department;
    agentRunId: string;
    eventType:
      | "tool_call_attempted"
      | "tool_call_allowed"
      | "tool_call_blocked"
      | "tool_call_executed"
      | "tool_call_failed";
    toolName: string;
    toolInput?: unknown;
    toolOutput?: unknown;
    /** See activity_log.agent_node_id — only ever set by the eve-hook logging path. */
    agentNodeId?: string;
  }): Promise<void>;
}
