"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, randomInt } from "node:crypto";
import { db, ensureOrganization, integrations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";

const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";
const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

/**
 * Saves (or replaces) this org's outbound webhook connection — a
 * customer-owned Slack/Discord/Zapier "incoming webhook URL", stored in
 * `integrations.config` per the schema's comment on that column. Upserts
 * on (orgId, provider="webhook"), matching the unique index
 * `integrations_org_provider_idx`. Admin-only, same gate as budgets.
 *
 * Validation here is deliberately shallow: syntactically-valid `https://`
 * URL only. Confirming it's a *real* Slack/Discord endpoint would need a
 * live test-POST, which is out of scope for save-time validation — the
 * post_webhook tool's own execution is where a bad URL actually surfaces.
 */
export async function saveWebhookConnection(formData: FormData) {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();

  const url = formData.get("url");
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("A webhook URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must be https://.");
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "webhook")))
    .limit(1);

  if (existing[0]) {
    await db
      .update(integrations)
      .set({ config: { url: parsed.toString() }, status: "active", connectedByClerkUserId: userId })
      .where(eq(integrations.id, existing[0].id));
  } else {
    await db.insert(integrations).values({
      orgId: org.id,
      provider: "webhook",
      config: { url: parsed.toString() },
      status: "active",
      connectedByClerkUserId: userId,
    });
  }

  revalidatePath("/dashboard/connections");
}

/**
 * Deletes this org's webhook connection row outright rather than setting
 * status="revoked" — there's nothing worth keeping a revoked row around
 * for (no history/audit view reads it), and deleting keeps the upsert
 * above simple (no stale revoked row to reactivate).
 */
export async function removeWebhookConnection() {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .delete(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "webhook")));

  revalidatePath("/dashboard/connections");
}

/**
 * Starts the GitHub OAuth App flow. `state` is a plain random anti-CSRF
 * nonce, not a signed identity token — the callback route re-derives the
 * org from the live Clerk session (same as every other action in this
 * file), not from anything in the redirect URL, so `state` only needs to
 * prove the callback is answering *this* browser's own request, matching
 * the value stashed in an httpOnly cookie here.
 */
export async function startGithubConnect(): Promise<never> {
  await requireOrgAdmin();

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("GITHUB_OAUTH_CLIENT_ID is not configured.");
  }
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — refusing to start an OAuth flow with a broken callback URL.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3311";

  // `secure` must match whether the app is actually served over https, not
  // just NODE_ENV — this ALB currently has no TLS listener (plain http://),
  // and a Secure cookie is silently never sent back by the browser over
  // plain http, which made every callback fail state verification
  // (confirmed live: state_mismatch on every attempt). Deriving from
  // NEXT_PUBLIC_APP_URL means this becomes correct automatically once TLS
  // is added, without another code change.
  const state = randomBytes(32).toString("hex");
  (await cookies()).set(GITHUB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${appUrl}/dashboard/connections/github/callback`);
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set("state", state);

  redirect(authorizeUrl.toString());
}

/**
 * Deletes this org's GitHub connection outright, same reasoning as
 * removeWebhookConnection — nothing reads a "revoked" row, so there's no
 * value in keeping one around instead of just deleting it. This does not
 * revoke the token on GitHub's side (GitHub OAuth Apps have no App-driven
 * revoke-on-behalf-of-user endpoint without asking for admin:org-level
 * scopes we don't otherwise need) — the stored copy is gone, which is what
 * this app can actually promise.
 */
export async function disconnectGithub() {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .delete(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "github")));

  revalidatePath("/dashboard/connections");
}

/**
 * Starts the Google OAuth flow for read-only Calendar access. Same
 * state-cookie CSRF pattern as startGithubConnect. `access_type=offline`
 * + `prompt=consent` are required to actually get a `refresh_token` back
 * on the token exchange — Google only issues one on the *first* consent
 * for a given client+user unless `prompt=consent` forces a fresh one, and
 * without offline access it issues no refresh token at all (Google's
 * short-lived ~1hr access tokens would otherwise die silently between
 * scheduled runs).
 */
export async function startGoogleCalendarConnect(): Promise<never> {
  await requireOrgAdmin();

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured.");
  }
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — refusing to start an OAuth flow with a broken callback URL.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3311";

  const state = randomBytes(32).toString("hex");
  (await cookies()).set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${appUrl}/dashboard/connections/google-calendar/callback`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.readonly");
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  redirect(authorizeUrl.toString());
}

export async function disconnectGoogleCalendar() {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .delete(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "google_calendar")));

  revalidatePath("/dashboard/connections");
}

const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60_000;

/**
 * Generates a fresh /link <code> for this org and stores it as a
 * "pending" integrations row — the same row agent/lib/telegram-link.ts's
 * consumeLinkCode() activates once the org actually sends the code to the
 * bot. Platform-level bot (TELEGRAM_BOT_TOKEN lives in agent-runtime's own
 * env, not here) — this action never touches the bot token itself, it
 * only writes the code the admin needs to type into Telegram.
 */
export async function generateTelegramLinkCode() {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  // CSPRNG, not Math.random() — flagged by automated security review
  // (Math.random() is predictable, and this code gates cross-org message
  // routing, not a cosmetic id). 10 chars over this 33-char alphabet is
  // ~50 bits of entropy (33^10), matching the reviewer's suggested floor.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let code = "";
  for (let i = 0; i < 10; i++) code += alphabet[randomInt(alphabet.length)];
  const config = { linkCode: code, linkCodeExpiresAt: new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS).toISOString() };

  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "telegram")))
    .limit(1);

  if (existing[0]) {
    await db
      .update(integrations)
      .set({ status: "pending", config, connectedByClerkUserId: userId })
      .where(eq(integrations.id, existing[0].id));
  } else {
    await db.insert(integrations).values({
      orgId: org.id,
      provider: "telegram",
      status: "pending",
      config,
      connectedByClerkUserId: userId,
    });
  }

  revalidatePath("/dashboard/connections");
}

export async function disconnectTelegram() {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db.delete(integrations).where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "telegram")));

  revalidatePath("/dashboard/connections");
}
