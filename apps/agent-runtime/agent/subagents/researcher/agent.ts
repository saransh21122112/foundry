import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Research & content: market/competitor research and written content (blog posts, reports, summaries) for the organization.",
  model: anthropic("claude-sonnet-5"),
});
