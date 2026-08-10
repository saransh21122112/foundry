import { and, eq, sql } from "drizzle-orm";
import { db, integrations } from "@foundry/db";

/**
 * Resolves an inbound Telegram chat to the org it's linked to, and handles
 * the `/link <code>` command that creates that link. A Telegram webhook
 * carries no org identifier of its own — this is what maps a chat id to a
 * tenant, the same job Clerk's session token does for the dashboard (see
 * agent/channels/eve.ts's clerkOrgSession()).
 *
 * One platform-level bot for every org (TELEGRAM_BOT_TOKEN, set once in
 * infra), not a per-org bot — same reasoning as the platform-level Twilio
 * account: a Telegram bot token isn't an OAuth-per-user credential to
 * begin with, so there's nothing for a per-org "connect" flow to exchange.
 * The org proves it owns a chat by typing a short-lived code generated
 * from its own dashboard (apps/web/app/dashboard/connections/actions.ts's
 * generateTelegramLinkCode — the code itself is only ever generated
 * there, this file only ever consumes one).
 */

/** Chat id (already linked) → orgId, or null if this chat has no active link. */
export async function resolveOrgIdForChat(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: integrations.orgId })
    .from(integrations)
    .where(
      and(
        eq(integrations.provider, "telegram"),
        eq(integrations.status, "active"),
        sql`${integrations.config}->>'chatId' = ${chatId}`,
      ),
    )
    .limit(1);
  return row?.orgId ?? null;
}

/**
 * Consumes a `/link <code>` attempt: if `code` matches a pending,
 * unexpired link request, activates it against `chatId` and returns the
 * orgId. Returns null (and leaves the pending row alone) on any mismatch
 * — deliberately no distinction in the return value between "wrong code"
 * and "expired code" to avoid giving a chat-based guesser useful signal.
 */
export async function consumeLinkCode(code: string, chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: integrations.id, orgId: integrations.orgId, config: integrations.config })
    .from(integrations)
    .where(
      and(
        eq(integrations.provider, "telegram"),
        eq(integrations.status, "pending"),
        sql`${integrations.config}->>'linkCode' = ${code.toUpperCase()}`,
      ),
    )
    .limit(1);

  if (!row) return null;
  const expiresAt = (row.config as { linkCodeExpiresAt?: string } | null)?.linkCodeExpiresAt;
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) return null;

  await db
    .update(integrations)
    .set({ status: "active", config: { chatId }, connectedAt: new Date() })
    .where(eq(integrations.id, row.id));

  return row.orgId;
}
