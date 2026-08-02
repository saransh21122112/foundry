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
 * clone of sales-lead's send_email.ts: same riskClass/approval wiring,
 * same real-outcome activity logging on both success and failure.
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
      // no-org sessions before execute() ever runs. Fail loud rather
      // than logActivity with a garbage orgId that'd just break the FK.
      throw new Error("No organization resolved on this session.");
    }
    const agentRunId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    const logCtx = { orgId, department: "ops-manager" as const, agentRunId };

    const [connection] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "webhook")))
      .limit(1);

    if (!connection || connection.status !== "active") {
      const message = "No webhook connected — ask an admin to add one at /dashboard/connections.";
      await dbDeps.logActivity({
        ...logCtx,
        eventType: "tool_call_failed",
        toolName: "post_webhook",
        toolInput: input,
        toolOutput: { error: message },
      });
      throw new Error(message);
    }

    const url = (connection.config as { url?: string } | null)?.url;
    if (typeof url !== "string" || url.length === 0) {
      const message = "Webhook connection has no URL configured — ask an admin to fix it at /dashboard/connections.";
      await dbDeps.logActivity({
        ...logCtx,
        eventType: "tool_call_failed",
        toolName: "post_webhook",
        toolInput: input,
        toolOutput: { error: message },
      });
      throw new Error(message);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const message = `Webhook endpoint returned ${res.status}: ${body.slice(0, 200)}`;
        await dbDeps.logActivity({
          ...logCtx,
          eventType: "tool_call_failed",
          toolName: "post_webhook",
          toolInput: input,
          toolOutput: { error: message },
        });
        throw new Error(message);
      }

      await dbDeps.logActivity({
        ...logCtx,
        eventType: "tool_call_executed",
        toolName: "post_webhook",
        toolInput: input,
        toolOutput: { status: res.status },
      });

      return { posted: true, status: res.status };
    } catch (err) {
      // Network errors / timeouts don't hit the res.ok branch above —
      // log and rethrow here too so every failure path leaves a real
      // tool_call_failed row rather than crashing the task silently.
      if (err instanceof Error && err.message.startsWith("Webhook endpoint returned")) {
        throw err; // already logged above
      }
      const message = err instanceof Error ? err.message : String(err);
      await dbDeps.logActivity({
        ...logCtx,
        eventType: "tool_call_failed",
        toolName: "post_webhook",
        toolInput: input,
        toolOutput: { error: message },
      });
      throw new Error(`Failed to reach webhook: ${message}`);
    }
  },
});
