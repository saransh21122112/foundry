import { defineAgent } from "eve";
import { anthropic } from "@ai-sdk/anthropic";

export default defineAgent({
  description:
    "Design: visual/UX work — landing pages, product UI, brand consistency — for the organization's projects.",
  model: anthropic("claude-sonnet-5"),
});
