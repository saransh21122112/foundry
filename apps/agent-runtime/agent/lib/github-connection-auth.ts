import { and, eq } from "drizzle-orm";
import { db, decryptToken, integrations } from "@foundry/db";

/**
 * Per-caller `auth` resolver for agent/connections/github.ts. This is an
 * out-of-band OAuth flow (GitHub OAuth App, encrypted token stored by
 * apps/web/app/dashboard/connections/github/callback/route.ts) rather than
 * eve's own `defineInteractiveAuthorization`/Vercel Connect — connecting
 * GitHub is a one-time admin settings action done ahead of time, same as
 * the existing webhook connection, not a mid-conversation OAuth prompt.
 * Same shape as post_webhook.ts's own org/connection lookup.
 */
export async function resolveGithubToken(orgId: string): Promise<string> {
  const [connection] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "github")))
    .limit(1);

  if (!connection || connection.status !== "active" || !connection.encryptedToken) {
    throw new Error("No GitHub account connected — ask an admin to connect one at /dashboard/connections.");
  }

  return decryptToken(connection.encryptedToken);
}
