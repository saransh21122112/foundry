import { defineChannel, GET } from "eve/channels";

/**
 * Receive-only channel used exclusively by
 * `agent/schedules/daily-ops-summary.ts` to start a real, durable eve
 * session per organization from a cron tick.
 *
 * The default `agent/channels/eve.ts` channel is HTTP-inbound only (see
 * node_modules/eve/docs/channels/eve.mdx — it has no `receive` hook), so
 * it can't be the target of a schedule's `receive(...)` call. Slack/
 * Discord/etc. have one because they need a real platform destination for
 * the reply; this app has no proactive delivery channel configured yet.
 * Since the honest place for a schedule-triggered digest to land is a
 * normal eve session the existing `/dashboard/run?session=<id>` page can
 * already render, this channel exists purely to be a legal `receive`
 * target: no routes of its own, just a pass-through to `send`.
 */
export default defineChannel({
  // A channel needs at least one route to be discovered and registered as
  // a valid cross-channel `receive` target at all — an empty `routes: []`
  // compiles fine but leaves the channel unregistered (confirmed live: it
  // never showed up in GET /eve/v1/info's channel list, and receive()
  // failed with "the channel passed as the first argument is not
  // registered in this agent's channels/"). This route is otherwise
  // unused; it exists only to make the channel a real, discoverable one.
  routes: [GET("/ops-digest/ping", async () => Response.json({ ok: true }))],
  async receive({ message, auth }, { send }) {
    return send(message, {
      auth,
      continuationToken: crypto.randomUUID(),
    });
  },
});
