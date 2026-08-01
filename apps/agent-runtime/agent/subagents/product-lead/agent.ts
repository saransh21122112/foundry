import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Product: turns a raw idea or request into a scoped, sequenced brief; makes roadmap/prioritization calls grounded in the org's own priorities.",
  model: "anthropic/claude-sonnet-5",
});
