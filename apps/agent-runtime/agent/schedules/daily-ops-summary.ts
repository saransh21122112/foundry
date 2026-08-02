import { defineSchedule } from "eve/schedules";
import { db, organizations, runSessions } from "@foundry/db";

import opsDigest from "../channels/ops-digest";

/**
 * Runs once a day and asks ops-manager to summarize the last 24h of this
 * app's own guardrails activity (packages/db's activityLog +
 * approvalRequests — see ops-manager/tools/get_daily_ops_digest.ts) into a
 * short digest. First proof of eve's schedule mechanism in this repo.
 *
 * Per-tenant fan-out: eve's schedules run at the app level with no session
 * or orgId of their own (see node_modules/eve/docs/patterns/
 * dynamic-scheduling.md) — the documented pattern there is for
 * tenant-authored dynamic schedules (a custom store + CRUD tools + a
 * minute-level dispatcher), which is real machinery for schedules a user
 * creates through the product. There's no such per-tenant row to dispatch
 * here; every org gets the same fixed daily digest. So this schedule takes
 * the honest simpler path the task called for: it queries `organizations`
 * directly (same direct-db-access pattern get_activity_summary.ts already
 * proves is fine from inside eve tool/schedule code) and loops, running
 * the digest once per org.
 *
 * Delivery: this app has no notification channel wired (no Slack/email).
 * `../channels/ops-digest.ts` is a minimal channel added just so a
 * schedule can `receive(...)` into a real durable session — the default
 * `agent/channels/eve.ts` channel is HTTP-inbound only and has no
 * `receive` hook (see node_modules/eve/docs/channels/eve.mdx). Each
 * session is then indexed into `run_sessions`, the same table
 * apps/web/app/dashboard/run/actions.ts's startTask writes to, so the
 * digest shows up in that org's existing task list — not just reachable
 * by guessing a session id.
 */
export default defineSchedule({
  cron: "0 9 * * *", // 09:00 UTC daily
  run({ receive, waitUntil }) {
    waitUntil(
      (async () => {
        const orgs = await db.select({ id: organizations.id }).from(organizations);

        // Promise.allSettled, not all: one org's failure (a bad receive(),
        // a DB hiccup) shouldn't cost every other org its daily digest.
        const results = await Promise.allSettled(
          orgs.map(async (org) => {
            const session = await receive(opsDigest, {
              message: [
                "Ask ops-manager to produce today's daily ops summary:",
                "call get_daily_ops_digest for the past 24 hours and turn the",
                "result into a short digest — tool calls attempted/allowed/",
                "executed/blocked/failed, any kill-switch events, and how many",
                "approval requests are still pending.",
                "",
                "This is a scheduled run with no human in the loop right now:",
                "finish with the digest as your final message rather than",
                "asking a question.",
              ].join(" "),
              target: {},
              auth: {
                authenticator: "app",
                principalId: "eve:schedule/daily-ops-summary",
                principalType: "runtime",
                attributes: { orgId: org.id },
              },
            });

            await db.insert(runSessions).values({
              id: session.id,
              orgId: org.id,
              createdByClerkUserId: "eve:schedule/daily-ops-summary",
              title: `Daily ops summary — ${new Date().toISOString().slice(0, 10)}`,
            });
          }),
        );

        for (const [i, result] of results.entries()) {
          if (result.status === "rejected") {
            console.error("[daily-ops-summary] failed for org", orgs[i]?.id, result.reason);
          }
        }
      })(),
    );
  },
});
