import { telegramChannel } from "eve/channels/telegram";
import { consumeLinkCode, resolveOrgIdForChat } from "../lib/telegram-link";

/**
 * eve's built-in Telegram channel (node_modules/eve/docs/channels/
 * telegram.mdx) — not hand-built. Mounts at POST /eve/v1/telegram, already
 * covered by infra's existing `/eve/*` ALB routing rule, no infra route
 * change needed. The app must still call Telegram's own `setWebhook` API
 * once, pointing at `<BASE_URL>/eve/v1/telegram` (see DEPLOY.md) — eve
 * doesn't register the webhook itself.
 *
 * `onMessage` is the exact hook this needed: TelegramChannelConfig's own
 * doc comment says it "defaults to Telegram user auth and dispatch
 * gating" and can be overridden — confirmed by reading
 * telegramChannel.d.ts directly rather than guessing. Every inbound
 * message is checked against the org-linking table
 * (agent/lib/telegram-link.ts) before eve is allowed to start a real
 * session — a webhook payload carries no org identifier of its own, so
 * this is the only place that mapping happens.
 */
export default telegramChannel({
  async onMessage(ctx, message) {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() ?? "";

    const linkMatch = text.match(/^\/link\s+([A-Za-z0-9]{10})$/);
    if (linkMatch) {
      const orgId = await consumeLinkCode(linkMatch[1], chatId);
      await ctx.telegram.sendMessage(
        orgId
          ? "Linked! This chat is now connected to your Foundry organization."
          : "That code isn't valid or has expired — generate a new one at /dashboard/connections.",
      );
      // A linking command is never itself agent input — drop the update
      // rather than starting a session for it.
      return { auth: null };
    }

    const orgId = await resolveOrgIdForChat(chatId);
    if (!orgId) {
      await ctx.telegram.sendMessage(
        "This chat isn't linked to a Foundry organization yet. Get a code at /dashboard/connections and send /link <code> here.",
      );
      return { auth: null };
    }

    return {
      auth: {
        authenticator: "app",
        principalId: `eve:channel/telegram:${message.from?.id ?? chatId}`,
        principalType: "runtime",
        attributes: { orgId },
      },
    };
  },
});
