import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, integrations } from "@foundry/db";
import { disconnectGithub, removeWebhookConnection, saveWebhookConnection, startGithubConnect } from "./actions";

const GITHUB_ERROR_LABEL: Record<string, string> = {
  state_mismatch: "That GitHub connection attempt looked stale or tampered with — try connecting again.",
  not_configured: "GitHub isn't configured on this deployment yet.",
  not_signed_in: "You need to be signed in as an org admin to connect GitHub.",
  exchange_failed: "GitHub didn't accept that authorization — try connecting again.",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ github_error?: string; github?: string }>;
}) {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  const { github_error: githubError } = await searchParams;

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
  const [github] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "github")))
    .limit(1);

  return (
    <main>
      <p className="eyebrow">Real tools, gated the same way as everything else</p>
      <h1>Connections</h1>

      {githubError && (
        <div className="callout" style={{ borderColor: "var(--ember-hot)" }}>
          {GITHUB_ERROR_LABEL[githubError] ?? `GitHub connection failed (${githubError}).`}
        </div>
      )}

      <p className="eyebrow" style={{ marginTop: 32 }}>GitHub</p>
      <p className="lede">
        Connect a GitHub account so eng-lead and swe-lead can read issues and pull requests
        and post comments in your real repos — every call still stops for your approval
        first, same as any other gated action.
      </p>
      <div className="panel">
        {github ? (
          <>
            <p style={{ margin: "0 0 4px" }}>Connected</p>
            <p style={{ fontSize: 13, color: "var(--iron-dim)" }}>
              Status: {github.status} · Scopes: {(github.scopes as string[] | null)?.join(", ") || "none"}
            </p>
            <form action={disconnectGithub}>
              <button type="submit" className="btn">
                Disconnect
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="panel-empty">No GitHub account connected yet.</p>
            <form action={startGithubConnect}>
              <button type="submit" className="btn btn-primary">
                Connect GitHub
              </button>
            </form>
          </>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Outbound webhooks</p>
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
