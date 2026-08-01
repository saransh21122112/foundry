import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Data & analytics: dashboards, metrics definitions, and reporting for the organization's data-heavy projects and its own operating metrics.",
  model: "anthropic/claude-sonnet-5",
});
