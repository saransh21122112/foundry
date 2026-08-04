import { defineTool } from "eve/tools";
import { z } from "zod";
import { Resend } from "resend";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Reference implementation showing the pattern every side-effecting tool in
 * this project follows: declare a riskClass, wire `approval` to
 * makeApprovalPolicy() (backed by packages/guardrails' enforce()), and only
 * touch the real provider once eve has resolved that policy to
 * "not-applicable" (enforce() said allow) or the human approved a paused
 * request.
 *
 * Sends via a single shared Resend account (not a per-org Vercel Connect
 * connection — that's real Phase 2 work for letting a customer connect
 * their own sending domain/inbox, not done here). `onboarding@resend.dev`
 * is Resend's own shared test-sending address; swap for a verified domain
 * once one exists.
 *
 * `enforce()` (via the `approval` policy below) only covers the
 * attempt/allow/block decision — it has no visibility into whether the
 * provider call that follows actually succeeds. The real
 * `tool_call_executed`/`tool_call_failed` outcome is logged generically by
 * the action.result eve hook (see
 * apps/agent-runtime/agent/lib/log-tool-result.ts), not hand-written here.
 */
const resend = new Resend(process.env.RESEND_API_KEY);

export default defineTool({
  description: "Send an outreach email on behalf of this organization.",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  approval: makeApprovalPolicy(
    {
      department: "sales-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "emails_sent", amount: 1 },
    },
    dbDeps,
  ),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      // Shouldn't happen — the approval policy above already denies
      // no-org sessions before execute() ever runs. Fail loud rather
      // than silently attributing this call to a garbage orgId.
      throw new Error("No organization resolved on this session.");
    }

    const { data, error } = await resend.emails.send({
      from: "Foundry <onboarding@resend.dev>",
      to: input.to,
      subject: input.subject,
      text: input.body,
    });

    if (error) {
      throw new Error(`Resend rejected the send: ${error.message}`);
    }

    return { sent: true, resendId: data?.id };
  },
});
