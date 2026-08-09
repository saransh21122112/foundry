import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Engineering: writes code, reviews changes, plans technical implementation, triages bugs for the organization's own projects.",
  model: anthropic("claude-sonnet-5"),
});
