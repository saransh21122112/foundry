import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Software Engineering: role-shaped implementation work — frontend, backend, UI/UX design — for the organization's projects. Separate from eng-lead's general build/review/triage remit; delegates to nested frontend-developer, backend-developer, and ui-ux-designer subagents.",
  model: "anthropic/claude-sonnet-5",
});
