import type { EnforceContext, EnforceResult, GuardrailDeps, ToolCall } from "./types.js";

/**
 * Risk classes that ALWAYS require human approval, regardless of an org's
 * configured autonomy_level. This is a code constant, not a database row —
 * a customer can narrow their own autonomy settings, but nothing in the
 * product lets them widen past this ceiling. Review changes to this list
 * like a security change, not a product tweak.
 */
const HARD_RULE_RISK_CLASSES = new Set(["irreversible", "financial", "legal"]);

/**
 * The single chokepoint every gated tool call passes through. Call this
 * from a tool's eve `approval` policy (see eve-adapter.ts) — never let an
 * agent tool call a provider API directly without going through here first.
 *
 * Every path (allow, require_approval, deny) logs to activity_log via
 * deps.logActivity so the audit trail is complete regardless of outcome.
 */
export async function enforce(
  ctx: EnforceContext,
  toolCall: ToolCall,
  deps: GuardrailDeps,
): Promise<EnforceResult> {
  await deps.logActivity({
    orgId: ctx.orgId,
    department: ctx.department,
    agentRunId: ctx.agentRunId,
    eventType: "tool_call_attempted",
    toolName: toolCall.name,
    toolInput: toolCall.input,
  });

  const block = async (reason: string): Promise<EnforceResult> => {
    await deps.logActivity({
      orgId: ctx.orgId,
      department: ctx.department,
      agentRunId: ctx.agentRunId,
      eventType: "tool_call_blocked",
      toolName: toolCall.name,
      toolInput: toolCall.input,
    });
    return { verdict: "deny", reason };
  };

  const requireApproval = async (reason: string): Promise<EnforceResult> => {
    const request = await deps.createApprovalRequest({
      orgId: ctx.orgId,
      department: ctx.department,
      agentRunId: ctx.agentRunId,
      eveCallId: ctx.eveCallId,
      toolName: toolCall.name,
      toolInput: toolCall.input,
      reason,
    });
    await deps.logActivity({
      orgId: ctx.orgId,
      department: ctx.department,
      agentRunId: ctx.agentRunId,
      eventType: "tool_call_blocked",
      toolName: toolCall.name,
      toolInput: toolCall.input,
    });
    return { verdict: "require_approval", reason, approvalRequestId: request.id };
  };

  // 1. Kill switch — cheapest, always-on, checked first.
  if (await deps.isKillSwitchActive(ctx.orgId, ctx.department)) {
    return block("kill_switch_active");
  }

  // 2. Department on/off switch — distinct from autonomy level: this is
  // "does this department run at all", autonomy level is "how much can it
  // do once running".
  if (!(await deps.isDepartmentEnabled(ctx.orgId, ctx.department))) {
    return block("department_disabled");
  }

  // 3. Autonomy level.
  const autonomyLevel = await deps.getAutonomyLevel(ctx.orgId, ctx.department);
  if (autonomyLevel === "off") {
    return block("autonomy_off");
  }
  const isSideEffecting = toolCall.riskClass !== "reversible-low";
  if (autonomyLevel === "draft_only" && isSideEffecting) {
    return requireApproval("draft_mode");
  }

  // 4. Hard-coded always-pause rules — not configurable per org.
  if (HARD_RULE_RISK_CLASSES.has(toolCall.riskClass)) {
    return requireApproval(`hard_rule:${toolCall.riskClass}`);
  }

  // 5. Budget cap.
  const budget = await deps.checkAndReserveBudget(ctx.orgId, ctx.department, toolCall.estimatedCost);
  if (!budget.withinBudget) {
    return requireApproval("budget_exceeded");
  }

  // 6. Tool allowlist.
  if (!(await deps.isToolAllowed(ctx.orgId, ctx.department, toolCall.name))) {
    return block("not_in_allowlist");
  }

  // 7. Rate limit.
  if (!(await deps.checkRateLimit(ctx.orgId, ctx.department, toolCall.name))) {
    return requireApproval("rate_limit_exceeded");
  }

  // 8. All checks passed.
  await deps.logActivity({
    orgId: ctx.orgId,
    department: ctx.department,
    agentRunId: ctx.agentRunId,
    eventType: "tool_call_allowed",
    toolName: toolCall.name,
    toolInput: toolCall.input,
  });
  return { verdict: "allow" };
}
