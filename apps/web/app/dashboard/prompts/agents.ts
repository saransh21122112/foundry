/**
 * Hardcoded manifest of every agent/subagent `instructions.md` that exists
 * today under apps/agent-runtime/agent/ — deliberately not a filesystem
 * walk, so actions.ts has a fixed, auditable set of paths to resolve
 * against instead of ever touching a path the client sent directly. Keep
 * this in sync by hand if a new subagent is added.
 */
export const AGENT_PROMPTS = [
  { id: "root", label: "Root orchestrator", path: "agent/instructions.md" },
  { id: "eng-lead", label: "eng-lead", path: "agent/subagents/eng-lead/instructions.md" },
  {
    id: "eng-lead/code-reviewer",
    label: "code-reviewer",
    parent: "eng-lead",
    path: "agent/subagents/eng-lead/subagents/code-reviewer/instructions.md",
  },
  { id: "product-lead", label: "product-lead", path: "agent/subagents/product-lead/instructions.md" },
  { id: "researcher", label: "researcher", path: "agent/subagents/researcher/instructions.md" },
  { id: "ops-manager", label: "ops-manager", path: "agent/subagents/ops-manager/instructions.md" },
  { id: "design-lead", label: "design-lead", path: "agent/subagents/design-lead/instructions.md" },
  { id: "data-lead", label: "data-lead", path: "agent/subagents/data-lead/instructions.md" },
  { id: "sales-lead", label: "sales-lead", path: "agent/subagents/sales-lead/instructions.md" },
  { id: "swe-lead", label: "swe-lead", path: "agent/subagents/swe-lead/instructions.md" },
  {
    id: "swe-lead/backend-developer",
    label: "backend-developer",
    parent: "swe-lead",
    path: "agent/subagents/swe-lead/subagents/backend-developer/instructions.md",
  },
  {
    id: "swe-lead/frontend-developer",
    label: "frontend-developer",
    parent: "swe-lead",
    path: "agent/subagents/swe-lead/subagents/frontend-developer/instructions.md",
  },
  {
    id: "swe-lead/ui-ux-designer",
    label: "ui-ux-designer",
    parent: "swe-lead",
    path: "agent/subagents/swe-lead/subagents/ui-ux-designer/instructions.md",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; path: string; parent?: string }>;

export type AgentPromptEntry = (typeof AGENT_PROMPTS)[number];
