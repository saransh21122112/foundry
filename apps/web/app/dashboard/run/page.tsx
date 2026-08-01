import { Suspense } from "react";
import { listTasks } from "./actions";
import { RunBoard } from "./RunBoard";

/**
 * Server component so the task sidebar has real data in the very first
 * HTML response — no client-side fetch waterfall just to show a list that
 * was already sitting in the database. RunBoard still refetches after
 * anything that changes the list (starting a task); this initial value is
 * purely a faster first paint.
 */
export default async function RunPage() {
  const initialTasks = await listTasks();
  return (
    <Suspense fallback={null}>
      <RunBoard initialTasks={initialTasks} />
    </Suspense>
  );
}
