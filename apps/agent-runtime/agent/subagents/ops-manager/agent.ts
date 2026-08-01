import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Operations: business/admin tasks, drafting invoices/contracts, tracking status, updating organization records.",
  model: "anthropic/claude-sonnet-5",
});
