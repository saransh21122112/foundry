import { defineSchedule } from "eve/schedules";
import { db, organizations, runSessions } from "@foundry/db";

import opsDigest from "../channels/ops-digest";

/**
 * The proactive "what should I work on" briefing — same shape as
 * daily-ops-summary.ts (clone of its per-org fan-out, receive(), and
 * run_sessions indexing so it shows up in the existing Run page task list
 * for free), but org-wide instead of ops-manager-only: uses
 * get_company_digest.ts (no department filter) and get_setup_changelog.ts
 * (config/connection changes) and asks for a synthesized "what happened /
 * what's new in your setup / what needs you / what to work on next"
 * briefing rather than a raw activity breakdown. Reuses the ops-digest channel as-is
 * (it's a plain pass-through `receive` target, not specific to the daily
 * ops summary despite the name) rather than adding a second channel that
 * would do exactly the same thing.
 */
export default defineSchedule({
  cron: "0 13 * * *", // 13:00 UTC daily — after daily-ops-summary's 09:00 UTC run, so this can reference a fresh digest
  run({ receive, waitUntil }) {
    waitUntil(
      (async () => {
        const orgs = await db.select({ id: organizations.id }).from(organizations);

        const results = await Promise.allSettled(
          orgs.map(async (org) => {
            const session = await receive(opsDigest, {
              message: [
                "Ask ops-manager to produce today's chief-of-staff briefing:",
                "call get_company_digest for the past 24 hours (org-wide, every",
                "department) and get_setup_changelog for the past 7 days, and turn",
                "the results into four short sections — what happened, what's new",
                "in your setup (newly connected integrations, department config",
                "changes — only mention this section if there's actually something",
                "new), what needs a human right now (pending approvals, anything",
                "blocked), and what to work on next. Keep it brief and actionable,",
                "not a raw data dump.",
                "",
                "This is a scheduled run with no human in the loop right now:",
                "finish with the briefing as your final message rather than",
                "asking a question.",
              ].join(" "),
              target: {},
              auth: {
                authenticator: "app",
                principalId: "eve:schedule/chief-of-staff-briefing",
                principalType: "runtime",
                attributes: { orgId: org.id },
              },
            });

            await db.insert(runSessions).values({
              id: session.id,
              orgId: org.id,
              createdByClerkUserId: "eve:schedule/chief-of-staff-briefing",
              title: `Chief of staff briefing — ${new Date().toISOString().slice(0, 10)}`,
            });
          }),
        );

        for (const [i, result] of results.entries()) {
          if (result.status === "rejected") {
            console.error("[chief-of-staff-briefing] failed for org", orgs[i]?.id, result.reason);
          }
        }
      })(),
    );
  },
});
