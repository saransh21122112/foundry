import { defineTool } from "eve/tools";
import { z } from "zod";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Second reference tool after sales-lead/tools/send_email.ts — same
 * pattern (riskClass + makeApprovalPolicy), different department, proving
 * the pattern isn't sales-lead-specific. `reversible-high` because a
 * published doc can be retracted/corrected but the fact of publishing is
 * still a real external action, not a pure read. Not wired to a real
 * destination yet (throws) — same "approved but no connection" state as
 * send_email until Phase 2 picks an actual publish target.
 */
export default defineTool({
  description: "Publish a finished research document externally on behalf of this organization.",
  inputSchema: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    destination: z.enum(["blog", "newsletter"]),
  }),
  approval: makeApprovalPolicy(
    { department: "researcher", riskClass: "reversible-high" },
    dbDeps,
  ),
  async execute(input) {
    throw new Error(
      `publish_research approved for "${input.title}" but no ${input.destination} destination is connected yet.`,
    );
  },
});
