import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Client-side implementation — UI components, pages, client state, styling integration. swe-lead delegates here for frontend-shaped work, distinct from backend-developer (server/API) and ui-ux-designer (design, not implementation).",
  model: anthropic("claude-sonnet-5"),
});
