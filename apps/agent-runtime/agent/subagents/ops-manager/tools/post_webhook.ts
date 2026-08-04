import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, integrations } from "@foundry/db";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Posts a short text notification to this org's connected outbound
 * webhook (Slack/Discord/Zapier incoming-webhook URL, saved by an admin
 * at /dashboard/connections — see that page's actions.ts). Structural
 * clone of sales-lead's send_email.ts: same riskClass/approval wiring.
 * Real-outcome activity logging (success and failure) is handled
 * generically by the action.result eve hook (see
 * apps/agent-runtime/agent/lib/log-tool-result.ts), not hand-written here.
 *
 * Payload shape is `{ text: string }` — the one JSON body both Slack's
 * and Discord's incoming-webhook endpoints accept for a plain-text
 * message (Discord also accepts `content`, but `text` is what Slack
 * requires and Discord tolerates extra/unknown top-level keys, so this
 * is the closer-to-universal choice). If a customer's real target is a
 * plain Zapier catch hook, `text` still arrives as a field on the
 * payload it receives.
 */
export default defineTool({
  description:
    "Post a short plain-text notification to this organization's connected webhook (Slack/Discord/Zapier). " +
    "Use this to notify an external channel about something (e.g. a digest is ready, a task finished). " +
    "Fails if no webhook is connected — the model should relay that the org needs to add one at " +
    "/dashboard/connections.",
  inputSchema: z.object({
    text: z.string().min(1),
  }),
  approval: makeApprovalPolicy(
    {
      department: "ops-manager",
      riskClass: "reversible-high",
      estimatedCost: { unit: "webhook_posts", amount: 1 },
    },
    dbDeps,
  ),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      // Shouldn't happen — the approval policy above already denies
      // no-org sessions before execute() ever runs.
      throw new Error("No organization resolved on this session.");
    }

    const [connection] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "webhook")))
      .limit(1);

    if (!connection || connection.status !== "active") {
      throw new Error("No webhook connected — ask an admin to add one at /dashboard/connections.");
    }

    const url = (connection.config as { url?: string } | null)?.url;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("Webhook connection has no URL configured — ask an admin to fix it at /dashboard/connections.");
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to reach webhook: ${message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Webhook endpoint returned ${res.status}: ${body.slice(0, 200)}`);
    }

    return { posted: true, status: res.status };
  },
});
