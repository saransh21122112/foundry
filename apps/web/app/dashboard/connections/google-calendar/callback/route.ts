import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, encryptToken, ensureOrganization, integrations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

/**
 * Google OAuth callback — completes the flow started by
 * startGoogleCalendarConnect() (../../actions.ts). Same
 * redirect-with-error-code-rather-than-throw shape as the GitHub callback,
 * for the same reason (this route is reached by the browser navigating
 * away from accounts.google.com, not a form submission this app controls).
 *
 * Unlike GitHub's OAuth App tokens (which don't expire),
 * Google's access token expires in ~1hr, so both it and the refresh token
 * (returned only on first consent — see startGoogleCalendarConnect's
 * prompt=consent) have to be stored. The access token goes in
 * `encryptedToken` like GitHub's; the refresh token + expiry go in
 * `config` (still ciphertext, just not the column GitHub happens to use)
 * since `integrations` has no dedicated refresh-token column.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    redirect("/dashboard/connections?google_error=state_mismatch");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    redirect("/dashboard/connections?google_error=not_configured");
  }

  let userId: string;
  let clerkOrgId: string;
  let orgSlug: string | null | undefined;
  try {
    const admin = await requireOrgAdmin();
    userId = admin.userId;
    clerkOrgId = admin.clerkOrgId;
    orgSlug = admin.orgSlug;
  } catch {
    redirect("/dashboard/connections?google_error=not_signed_in");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3311";
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${appUrl}/dashboard/connections/google-calendar/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    redirect("/dashboard/connections?google_error=exchange_failed");
  }

  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!tokenBody.access_token) {
    redirect(`/dashboard/connections?google_error=${encodeURIComponent(tokenBody.error ?? "no_token")}`);
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const encryptedToken = encryptToken(tokenBody.access_token!);
  const expiresAt = new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000).toISOString();
  const scopes = (tokenBody.scope ?? "").split(" ").filter(Boolean);

  const existing = await db
    .select({ id: integrations.id, config: integrations.config })
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "google_calendar")))
    .limit(1);

  // Google only returns a refresh_token on the very first consent for a
  // given client+user — a re-connect after prompt=consent should still get
  // one (that's the whole point of forcing the prompt), but fall back to
  // whatever was already stored rather than clobbering a working refresh
  // token with `undefined` on some future edge case.
  const previousConfig = existing[0]?.config as { encryptedRefreshToken?: string } | null;
  const encryptedRefreshToken = tokenBody.refresh_token
    ? encryptToken(tokenBody.refresh_token)
    : previousConfig?.encryptedRefreshToken;

  if (!encryptedRefreshToken) {
    redirect("/dashboard/connections?google_error=no_refresh_token");
  }

  const config = { encryptedRefreshToken, expiresAt };

  if (existing[0]) {
    await db
      .update(integrations)
      .set({ encryptedToken, config, scopes, status: "active", connectedByClerkUserId: userId })
      .where(eq(integrations.id, existing[0].id));
  } else {
    await db.insert(integrations).values({
      orgId: org.id,
      provider: "google_calendar",
      encryptedToken,
      config,
      scopes,
      status: "active",
      connectedByClerkUserId: userId,
    });
  }

  redirect("/dashboard/connections?google_calendar=connected");
}
