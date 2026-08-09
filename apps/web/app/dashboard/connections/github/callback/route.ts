import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, encryptToken, ensureOrganization, integrations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";

const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";

/**
 * GitHub OAuth App callback — completes the flow started by
 * startGithubConnect() (../../actions.ts). Any failure redirects back to
 * /dashboard/connections with an inline error code rather than throwing,
 * since this route is reached by the browser navigating away from
 * github.com, not by a form submission this app controls — a thrown error
 * here would just be Next.js's generic error page, not a place the user
 * can retry from.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GITHUB_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GITHUB_OAUTH_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    redirect("/dashboard/connections?github_error=state_mismatch");
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    redirect("/dashboard/connections?github_error=not_configured");
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
    redirect("/dashboard/connections?github_error=not_signed_in");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3311";
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${appUrl}/dashboard/connections/github/callback`,
    }),
  });

  if (!tokenRes.ok) {
    redirect("/dashboard/connections?github_error=exchange_failed");
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string; scope?: string };
  if (!tokenBody.access_token) {
    redirect(`/dashboard/connections?github_error=${encodeURIComponent(tokenBody.error ?? "no_token")}`);
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const encryptedToken = encryptToken(tokenBody.access_token!);
  const scopes = (tokenBody.scope ?? "").split(",").filter(Boolean);

  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "github")))
    .limit(1);

  if (existing[0]) {
    await db
      .update(integrations)
      .set({ encryptedToken, scopes, status: "active", connectedByClerkUserId: userId })
      .where(eq(integrations.id, existing[0].id));
  } else {
    await db.insert(integrations).values({
      orgId: org.id,
      provider: "github",
      encryptedToken,
      scopes,
      status: "active",
      connectedByClerkUserId: userId,
    });
  }

  redirect("/dashboard/connections?github=connected");
}
