import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Sales & marketing: outreach, pitch, and marketing copy; on bounded_autonomous orgs, may actually send outreach within guardrails.",
  model: anthropic("claude-sonnet-5"),
});
