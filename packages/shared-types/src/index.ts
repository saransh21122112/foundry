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
/**
 * remember/recall/forget (packages/agent-runtime's agent/lib/memory-tools.ts)
 * are registered identically for every department — cross-session memory,
 * ungated same as get_activity_summary/get_daily_ops_digest.
 */
const MEMORY_TOOLS: Array<{ name: string; riskClass: RiskClass; gated: boolean }> = [
  { name: "remember", riskClass: "reversible-low", gated: false },
  { name: "recall", riskClass: "reversible-low", gated: false },
  { name: "forget", riskClass: "reversible-low", gated: false },
];

export const KNOWN_TOOLS: Record<Department, Array<{ name: string; riskClass: RiskClass; gated: boolean }>> = {
  "eng-lead": [
    { name: "save_project_file", riskClass: "reversible-high", gated: true },
    { name: "clone_repo", riskClass: "reversible-high", gated: true },
    { name: "generate_repos_xlsx", riskClass: "reversible-high", gated: true },
    { name: "list_public_github_repos", riskClass: "reversible-low", gated: false },
    { name: "list_my_github_repos", riskClass: "reversible-low", gated: false },
    { name: "exec_host", riskClass: "reversible-high", gated: true },
    ...MEMORY_TOOLS,
  ],
  "product-lead": [...MEMORY_TOOLS],
  researcher: [{ name: "publish_research", riskClass: "reversible-high", gated: true }, ...MEMORY_TOOLS],
  "ops-manager": [
    { name: "post_webhook", riskClass: "reversible-high", gated: true },
    { name: "get_daily_ops_digest", riskClass: "reversible-low", gated: false },
    { name: "get_company_digest", riskClass: "reversible-low", gated: false },
    { name: "get_setup_changelog", riskClass: "reversible-low", gated: false },
    { name: "list_calendar_events", riskClass: "reversible-low", gated: false },
    { name: "place_call", riskClass: "financial", gated: true },
    { name: "get_call_result", riskClass: "reversible-low", gated: false },
    ...MEMORY_TOOLS,
  ],
  "design-lead": [...MEMORY_TOOLS],
  "data-lead": [{ name: "get_activity_summary", riskClass: "reversible-low", gated: false }, ...MEMORY_TOOLS],
  "sales-lead": [{ name: "send_email", riskClass: "reversible-high", gated: true }, ...MEMORY_TOOLS],
  "swe-lead": [{ name: "save_project_file", riskClass: "reversible-high", gated: true }, ...MEMORY_TOOLS],
};
