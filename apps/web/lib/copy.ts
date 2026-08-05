import type { AutonomyLevel, Department, RiskClass } from "@foundry/shared-types";

/** What each department actually does — shown on the Departments page. */
export const DEPARTMENT_BLURB: Record<Department, string> = {
  "eng-lead": "Writes and reviews code, fixes bugs, plans technical work.",
  "product-lead": "Turns raw ideas into scoped, sequenced work for other departments.",
  researcher: "Market research, competitor analysis, and written content.",
  "ops-manager": "Admin: invoices, contracts, status tracking, company records.",
  "design-lead": "Visual and UX work — pages, product UI, brand consistency.",
  "data-lead": "Dashboards, metrics definitions, and reporting.",
  "sales-lead": "Outreach and marketing copy — and sends it, if you allow that.",
  "swe-lead": "Role-shaped software engineering: frontend, backend, and UI/UX design work.",
};

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  off: "Off",
  draft_only: "Drafts only",
  bounded_autonomous: "Fully autonomous",
};

export const AUTONOMY_DESCRIPTION: Record<AutonomyLevel, string> = {
  off: "This department does nothing. No drafts, no actions, no matter what you ask it to do.",
  draft_only:
    "This department can research and prepare work, but anything with a real effect — sending an email, spending money, changing a record — stops and waits in your Approval queue first.",
  bounded_autonomous:
    "This department can act on its own, automatically, as long as it stays inside the budget and tool limits you've set below. A few things always stop for your approval regardless: spending beyond a cap, deleting anything, and legal or financial commitments.",
};

/** `approval_requests.reason` is a free-text code from enforce() — translate it. */
export const APPROVAL_REASON_LABEL: Record<string, string> = {
  draft_mode: "This department is set to “Drafts only,” so this needed your OK before it could run.",
  budget_exceeded: "This would go over the budget cap you've set for this department.",
  not_in_allowlist: "This specific action is turned off for this department.",
  rate_limit_exceeded: "This department has hit its rate limit for this action — too many, too fast.",
};
export function approvalReasonLabel(reason: string): string {
  if (reason.startsWith("hard_rule:")) {
    const risk = reason.slice("hard_rule:".length);
    return `This action is ${risk} — those always need your OK, no matter what autonomy level is set.`;
  }
  return APPROVAL_REASON_LABEL[reason] ?? reason;
}

export const RISK_CLASS_LABEL: Record<RiskClass, string> = {
  "reversible-low": "Low risk",
  "reversible-high": "Real effect",
  irreversible: "Can't be undone",
  financial: "Costs money",
  legal: "Legal / contractual",
};
export const RISK_CLASS_DESCRIPTION: Record<RiskClass, string> = {
  "reversible-low": "A read — looking something up, no side effects. Never needs approval.",
  "reversible-high": "Does something real (like sending an email) but can be corrected afterward.",
  irreversible: "Can't be undone once it happens. Always needs your approval.",
  financial: "Spends money or commits to a cost. Always needs your approval.",
  legal: "Legal or contractual weight. Always needs your approval.",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  tool_call_attempted: "Tried to run",
  tool_call_allowed: "Allowed automatically",
  tool_call_blocked: "Stopped — waiting on you or turned off",
  tool_call_executed: "Ran successfully",
  tool_call_failed: "Ran, but failed",
  approval_granted: "You approved it",
  approval_rejected: "You rejected it",
  kill_switch_triggered: "Emergency pause triggered",
  kill_switch_resolved: "Emergency pause lifted",
  subagent_delegated: "Delegated work to",
};
