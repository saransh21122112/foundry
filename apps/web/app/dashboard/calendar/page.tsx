import { auth } from "@clerk/nextjs/server";
import { listCalendarTasks } from "./actions";
import { CalendarBoard } from "./CalendarBoard";

/**
 * Weekly calendar + status board over `run_sessions` — the same task data
 * /dashboard/tasks lists flat, grouped by day-of-week (and, v1, by an
 * optional status) instead. Reads reuse listTasks's org-scoping pattern
 * (auth() -> ensureOrganization()); see actions.ts.
 */
export default async function CalendarPage() {
  const { orgId: clerkOrgId } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Calendar</h1>
        <p className="lede">Sign in and select or create an organization to see its tasks.</p>
      </main>
    );
  }

  const tasks = await listCalendarTasks();

  return (
    <main>
      <p className="eyebrow">This week</p>
      <h1>Calendar</h1>
      <p className="lede">
        Every task your company has run, grouped by the day it started. Click a card to reopen that task on{" "}
        <a href="/dashboard/tasks">Delegate a task</a>. Status is a v1 field — set it from a card&apos;s dropdown, nothing sets it
        automatically yet.
      </p>

      <CalendarBoard initialTasks={tasks} />
    </main>
  );
}
