import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Interface/UX design — flows, wireframes, interaction design, information architecture — as a draft for frontend-developer to implement. swe-lead delegates here for design-shaped work, distinct from design-lead (visual/brand across the whole org).",
  model: "anthropic/claude-sonnet-5",
});
