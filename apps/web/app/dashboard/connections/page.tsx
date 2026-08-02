import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, integrations } from "@foundry/db";
import { removeWebhookConnection, saveWebhookConnection } from "./actions";

export default async function ConnectionsPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Connections</h1>
        <p className="lede">Sign in and select or create an organization to manage connections.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [webhook] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "webhook")))
    .limit(1);

  return (
    <main>
      <p className="eyebrow">Outbound webhooks</p>
      <h1>Connections</h1>
      <p className="lede">
        Add a Slack, Discord, or Zapier &ldquo;incoming webhook&rdquo; URL and any department
        can post a short text notification to it (via the <code>post_webhook</code> tool).
        This product never sees your workspace or app credentials — just the URL you paste
        below, which you generate yourself on the other end.
      </p>

      <div className="panel">
        {webhook ? (
          <>
            <p className="mono" style={{ wordBreak: "break-all" }}>
              {(webhook.config as { url?: string } | null)?.url ?? "(no URL stored)"}
            </p>
            <p style={{ fontSize: 13, color: "var(--iron-dim)" }}>Status: {webhook.status}</p>
            <form action={removeWebhookConnection}>
              <button type="submit" className="btn">
                Remove
              </button>
            </form>
          </>
        ) : (
          <p className="panel-empty">No webhook connected yet.</p>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>
        {webhook ? "Replace webhook URL" : "Add a webhook URL"}
      </p>
      <div className="panel">
        <form action={saveWebhookConnection} className="field-row">
          <label>
            Webhook URL
            <input type="url" name="url" placeholder="https://hooks.slack.com/services/..." required />
          </label>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </form>
      </div>
    </main>
  );
}
