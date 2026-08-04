/**
 * Canonical cross-package enums. Both @foundry/db (Postgres enum columns)
 * and @foundry/guardrails (TypeScript union types) derive from these
 * single arrays instead of each hand-maintaining their own copy — added
 * 2026-07-29 after Phase 0 shipped with the same three enums duplicated
 * in packages/db/src/schema.ts and packages/guardrails/src/types.ts.
 */

export const DEPARTMENTS = [
  "eng-lead",
  "product-lead",
  "researcher",
  "ops-manager",
  "design-lead",
  "data-lead",
  "sales-lead",
  "swe-lead",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const AUTONOMY_LEVELS = ["off", "draft_only", "bounded_autonomous"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/**
 * Declared per tool wrapper at registration time (not editable by a
 * customer). `irreversible`, `financial`, and `legal` tools always require
 * human approval regardless of autonomy_level — see HARD_RULE_RISK_CLASSES
 * in packages/guardrails/src/enforce.ts.
 */
export const RISK_CLASSES = [
  "reversible-low",
  "reversible-high",
  "irreversible",
  "financial",
  "legal",
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/**
 * Hand-maintained registry of the tools actually declared under
 * apps/agent-runtime/agent/subagents/<dept>/tools/ — there's no dynamic
 * discovery yet, so this must be updated whenever a tool file is added.
 * `gated: false` (currently only `data-lead/get_activity_summary`, a
 * `reversible-low` tool with no `approval` field) means it bypasses
 * `enforce()`'s allowlist/budget/rate-limit checks entirely — toggling an
 * allowlist row for a non-gated tool has no effect, so the dashboard's
 * allowlist editor should only offer gated tools.
 */
export const KNOWN_TOOLS: Record<Department, Array<{ name: string; riskClass: RiskClass; gated: boolean }>> = {
  "eng-lead": [{ name: "save_project_file", riskClass: "reversible-low", gated: false }],
  "product-lead": [],
  researcher: [{ name: "publish_research", riskClass: "reversible-high", gated: true }],
  "ops-manager": [
    { name: "post_webhook", riskClass: "reversible-high", gated: true },
    { name: "get_daily_ops_digest", riskClass: "reversible-low", gated: false },
  ],
  "design-lead": [],
  "data-lead": [{ name: "get_activity_summary", riskClass: "reversible-low", gated: false }],
  "sales-lead": [{ name: "send_email", riskClass: "reversible-high", gated: true }],
  "swe-lead": [],
};
