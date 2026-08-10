import { defineTool } from "eve/tools";
import { z } from "zod";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { resolveGoogleCalendarToken } from "../../../lib/google-calendar-connection-auth";

/**
 * Plain fetch() against Google's Calendar REST API rather than
 * `defineOpenAPIConnection` (the pattern eng-lead/connections/github.ts
 * uses) — Google doesn't publish a first-party OpenAPI spec for Calendar
 * (only its own Discovery-doc format), and eng-lead/connections/github.ts's
 * own comment already documents that `operations.allow` is a no-op on this
 * eve version anyway, so the OpenAPI connection type's main selectivity
 * benefit doesn't hold today. Read-only (calendar.readonly scope, see
 * startGoogleCalendarConnect) — riskClass reversible-low / gated: false,
 * same convention as list_public_github_repos.ts and
 * get_daily_ops_digest.ts (pure reads, no external side effect).
 */
export default defineTool({
  description:
    "List upcoming events on the connected Google Calendar for the next N days (default 7). Use this for 'what's coming up' — deadlines, meetings — when building a status update or briefing.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).default(7),
    maxResults: z.number().int().min(1).max(50).default(25),
  }),
  async execute({ days, maxResults }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "ops-manager" }, dbDeps);

    const token = await resolveGoogleCalendarToken(orgId);
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Google Calendar API request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }>;
    };
    const events = (data.items ?? []).map((event) => ({
      summary: event.summary ?? "(no title)",
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
    }));

    return { events, count: events.length };
  },
});
