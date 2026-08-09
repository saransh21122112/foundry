import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Read-only review of a diff, PR, or file — style, correctness, and risk feedback only, no edits. eng-lead delegates here when the task is purely 'review this', not 'build/fix this'.",
  model: anthropic("claude-sonnet-5"),
});
