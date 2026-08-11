import { LiveTerminal } from "./LiveTerminal";

/**
 * Just the terminal — no chat composer, no transcript, no task sidebar.
 * The old eve-chat-based "Run a task" UI (RunBoard.tsx) is gone; a real
 * shell on ops-manager's own host is now this page's only job. eve task
 * delegation itself (startTask/sendFollowUp/listTasks in ./actions.ts)
 * is untouched and still real, working backend logic — Calendar's task
 * cards and any session created through it still exist — this page just
 * no longer renders a UI for starting/replaying one.
 */
export default function RunPage() {
  return (
    <main>
      <p className="eyebrow">Real, live shell</p>
      <h1>Run a task</h1>
      <p className="lede">
        A genuine terminal on this deployment&apos;s own host, real-time — not a log of what an agent did after the
        fact. Type directly into it.
      </p>
      <LiveTerminal />
    </main>
  );
}
