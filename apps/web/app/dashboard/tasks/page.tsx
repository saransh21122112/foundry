import { Suspense } from "react";
import { listTasks } from "./actions";
import { TaskBoard } from "./TaskBoard";

/**
 * The old eve-chat-based "Run a task" page, moved here from
 * /dashboard/run (now the live terminal, see run/page.tsx) so delegating
 * work to a department via chat still has a home. Server component so the
 * task sidebar has real data in the very first HTML response — no
 * client-side fetch waterfall just to show a list that was already
 * sitting in the database. TaskBoard still refetches after anything that
 * changes the list (starting a task); this initial value is purely a
 * faster first paint.
 */
export default async function TasksPage() {
  const initialTasks = await listTasks();
  return (
    <Suspense fallback={null}>
      <TaskBoard initialTasks={initialTasks} />
    </Suspense>
  );
}
