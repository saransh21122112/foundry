import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, integrations } from "@foundry/db";
import {
  disconnectGithub,
  disconnectGoogleCalendar,
  disconnectTelegram,
  generateTelegramLinkCode,
  removeWebhookConnection,
  saveWebhookConnection,
  startGithubConnect,
  startGoogleCalendarConnect,
} from "./actions";

const GITHUB_ERROR_LABEL: Record<string, string> = {
  state_mismatch: "That GitHub connection attempt looked stale or tampered with — try connecting again.",
  not_configured: "GitHub isn't configured on this deployment yet.",
  not_signed_in: "You need to be signed in as an org admin to connect GitHub.",
  exchange_failed: "GitHub didn't accept that authorization — try connecting again.",
};

const GOOGLE_ERROR_LABEL: Record<string, string> = {
  state_mismatch: "That Google connection attempt looked stale or tampered with — try connecting again.",
  not_configured: "Google Calendar isn't configured on this deployment yet.",
  not_signed_in: "You need to be signed in as an org admin to connect Google Calendar.",
  exchange_failed: "Google didn't accept that authorization — try connecting again.",
  no_refresh_token: "Google didn't grant offline access — try connecting again and approve every permission it asks for.",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ github_error?: string; github?: string; google_error?: string; google_calendar?: string }>;
}) {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  const { github_error: githubError, google_error: googleError } = await searchParams;

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
  const [googleCalendar] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "google_calendar")))
    .limit(1);
  const [telegram] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "telegram")))
    .limit(1);
  const telegramConfig = telegram?.config as { chatId?: string; linkCode?: string; linkCodeExpiresAt?: string } | null;
  const telegramLinkExpired =
    telegram?.status === "pending" &&
    (!telegramConfig?.linkCodeExpiresAt || new Date(telegramConfig.linkCodeExpiresAt).getTime() < Date.now());
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;

  return (
    <main>
      <p className="eyebrow">Real tools, gated the same way as everything else</p>
      <h1>Connections</h1>

      {githubError && (
        <div className="callout" style={{ borderColor: "var(--ember-hot)" }}>
          {GITHUB_ERROR_LABEL[githubError] ?? `GitHub connection failed (${githubError}).`}
        </div>
      )}

      {googleError && (
        <div className="callout" style={{ borderColor: "var(--ember-hot)" }}>
          {GOOGLE_ERROR_LABEL[googleError] ?? `Google Calendar connection failed (${googleError}).`}
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

      <p className="eyebrow" style={{ marginTop: 32 }}>Google Calendar</p>
      <p className="lede">
        Connect a Google account (read-only) so ops-manager can see what&rsquo;s on the
        calendar — deadlines and meetings feed into the daily chief-of-staff briefing&rsquo;s
        &ldquo;what to work on next&rdquo; section.
      </p>
      <div className="panel">
        {googleCalendar ? (
          <>
            <p style={{ margin: "0 0 4px" }}>Connected</p>
            <p style={{ fontSize: 13, color: "var(--iron-dim)" }}>
              Status: {googleCalendar.status} · Scopes:{" "}
              {(googleCalendar.scopes as string[] | null)?.join(", ") || "none"}
            </p>
            <form action={disconnectGoogleCalendar}>
              <button type="submit" className="btn">
                Disconnect
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="panel-empty">No Google account connected yet.</p>
            <form action={startGoogleCalendarConnect}>
              <button type="submit" className="btn btn-primary">
                Connect Google Calendar
              </button>
            </form>
          </>
        )}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Telegram</p>
      <p className="lede">
        Message your company from Telegram, not just this dashboard. One shared Foundry bot serves every
        organization — your chat is linked to yours (and only yours) by a short-lived code, not a shared credential.
      </p>
      <div className="panel">
        {telegram?.status === "active" ? (
          <>
            <p style={{ margin: "0 0 4px" }}>Connected</p>
            <p style={{ fontSize: 13, color: "var(--iron-dim)" }}>Chat linked — messages there reach your company.</p>
            <form action={disconnectTelegram}>
              <button type="submit" className="btn">
                Disconnect
              </button>
            </form>
          </>
        ) : telegram?.status === "pending" && !telegramLinkExpired ? (
          <>
            <p style={{ margin: "0 0 4px" }}>
              Message {botUsername ? `@${botUsername}` : "the Foundry bot"} on Telegram with:
            </p>
            <p className="mono" style={{ fontSize: 20, letterSpacing: 2 }}>/link {telegramConfig?.linkCode}</p>
            <p style={{ fontSize: 13, color: "var(--iron-dim)" }}>Expires in 15 minutes.</p>
            <form action={generateTelegramLinkCode}>
              <button type="submit" className="btn">
                Generate a new code
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="panel-empty">Not connected yet.</p>
            <form action={generateTelegramLinkCode}>
              <button type="submit" className="btn btn-primary">
                Get a link code
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
