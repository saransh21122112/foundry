import { and, eq } from "drizzle-orm";
import { db, decryptToken, encryptToken, integrations } from "@foundry/db";

type GoogleCalendarConfig = { encryptedRefreshToken: string; expiresAt: string };

/**
 * Per-caller token resolver for list_calendar_events.ts, same shape as
 * github-connection-auth.ts's resolveGithubToken but with the one piece of
 * real new logic GitHub never needed: Google access tokens expire in ~1hr,
 * so this refreshes (and re-persists) whenever the stored expiry has
 * passed, rather than assuming the stored access token is still good.
 * 60s of skew subtracted so a token that's *about* to expire mid-call
 * still gets refreshed proactively instead of failing the actual Calendar
 * API request.
 */
export async function resolveGoogleCalendarToken(orgId: string): Promise<string> {
  const [connection] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "google_calendar")))
    .limit(1);

  if (!connection || connection.status !== "active" || !connection.encryptedToken) {
    throw new Error("No Google Calendar account connected — ask an admin to connect one at /dashboard/connections.");
  }

  const config = connection.config as GoogleCalendarConfig | null;
  const expiresAt = config?.expiresAt ? new Date(config.expiresAt).getTime() : 0;
  if (expiresAt - 60_000 > Date.now()) {
    return decryptToken(connection.encryptedToken);
  }

  if (!config?.encryptedRefreshToken) {
    throw new Error("Google Calendar connection has no refresh token — ask an admin to reconnect it at /dashboard/connections.");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptToken(config.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      "Failed to refresh the Google Calendar connection's access token — ask an admin to reconnect it at /dashboard/connections.",
    );
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new Error("Google's token refresh response had no access_token.");
  }

  const newEncryptedToken = encryptToken(body.access_token);
  const newExpiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  await db
    .update(integrations)
    .set({ encryptedToken: newEncryptedToken, config: { ...config, expiresAt: newExpiresAt } })
    .where(eq(integrations.id, connection.id));

  return body.access_token;
}
