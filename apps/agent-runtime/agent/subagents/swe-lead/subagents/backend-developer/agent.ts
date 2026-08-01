import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Server-side implementation — APIs, data layer/schema, services, backend logic. swe-lead delegates here for backend-shaped work, distinct from frontend-developer (client-side) and ui-ux-designer (design).",
  model: "anthropic/claude-sonnet-5",
});
