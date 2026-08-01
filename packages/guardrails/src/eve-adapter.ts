import { enforce } from "./enforce.js";
import type { Department, GuardrailDeps, RiskClass } from "./types.js";

/**
 * Minimal shape of eve's ApprovalContext we actually need (see
 * node_modules/eve/docs/tools/human-in-the-loop.md — a tool's `approval`
 * function receives session + toolName/toolInput). Kept narrow here instead
 * of importing eve's own types so this package has no hard dependency on
 * eve and stays usable/testable outside an eve project.
 */
export interface EveApprovalContext {
  session: {
    id: string;
    auth: { current?: { attributes?: Record<string, unknown> } | null };
    /**
     * Present when this tool call happens inside a delegated subagent.
     * `rootSessionId` is the top-level, user-facing session that actually
     * owns the HTTP channel's `continuationToken` — verified live
     * (2026-07-29) that a subagent's own session never gets a
     * `session.waiting`/`continuationToken` of its own; only the root
     * session does. Resuming must target the root, not `session.id`.
     */
    parent?: { rootSessionId: string };
  };
  toolName: string;
  toolInput?: unknown;
  /** eve's own id for this specific tool call — see docs/tools/human-in-the-loop.md. */
  callId?: string;
}

/** What eve's `approval` field expects back (AI SDK 7 approval status). */
export type EveApprovalDecision =
  | "user-approval"
  | "not-applicable"
  | { type: "approved" | "denied"; reason?: string };

/**
 * Builds an eve `approval` policy function for a tool, backed by
 * packages/guardrails' enforce() pipeline. Use on every tool whose
 * riskClass is anything other than "reversible-low":
 *
 *   export default defineTool({
 *     ...,
 *     approval: makeApprovalPolicy({ department: "sales-lead", riskClass: "financial" }, deps),
 *     async execute(input, ctx) { ... },
 *   });
 *
 * enforce()'s "allow" maps to "not-applicable" (no human prompt needed —
 * the checks already passed). "deny" maps to a denied decision with a
 * reason the model sees. "require_approval" maps to "user-approval",
 * durably parking the run until a human resolves the queued request.
 */
export function makeApprovalPolicy(
  meta: { department: Department; riskClass: RiskClass; estimatedCost?: { unit: string; amount: number } },
  deps: GuardrailDeps,
) {
  return async (approvalCtx: EveApprovalContext): Promise<EveApprovalDecision> => {
    const orgId = approvalCtx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      // No resolved tenant on this session — never allow a gated action to
      // proceed without a known org to scope it to.
      return { type: "denied", reason: "no_org_on_session" };
    }

    const result = await enforce(
      {
        orgId,
        department: meta.department,
        agentRunId: approvalCtx.session.parent?.rootSessionId ?? approvalCtx.session.id,
        eveCallId: approvalCtx.callId,
      },
      {
        name: approvalCtx.toolName,
        input: approvalCtx.toolInput,
        riskClass: meta.riskClass,
        estimatedCost: meta.estimatedCost,
      },
      deps,
    );

    switch (result.verdict) {
      case "allow":
        return "not-applicable";
      case "deny":
        return { type: "denied", reason: result.reason };
      case "require_approval":
        return "user-approval";
    }
  };
}
