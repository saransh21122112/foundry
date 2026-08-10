"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CalendarTask } from "./actions";
import { setTaskStatus } from "./actions";

const STATUSES = [
  { id: "planning", label: "Planning" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" },
] as const;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the calendar week `date` falls in, at local midnight. */
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayIndex = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayIndex);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function TaskCard({ task, onStatusChange }: { task: CalendarTask; onStatusChange: (id: string, status: string) => void }) {
  return (
    <div className="calendar-card">
      <a href={`/dashboard/run?session=${task.id}`} className="calendar-card-title" title={task.title}>
        {task.title}
      </a>
      <div className="calendar-card-footer">
        <span className="mono calendar-card-time">
          {new Date(task.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        <select
          className="mono calendar-status-select"
          value={task.status ?? ""}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
        >
          <option value="">Unset</option>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function CalendarBoard({ initialTasks }: { initialTasks: CalendarTask[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [, startTransition] = useTransition();

  function handleStatusChange(id: string, status: string) {
    // Optimistic — the select already reflects the new value; setTaskStatus
    // failing just means a stale value until the next real refresh, not
    // worth a rollback for a v1 status field nothing else depends on yet.
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: status || null } : t)));
    startTransition(() => {
      setTaskStatus(id, status || null)
        .then(() => router.refresh())
        .catch(() => {});
    });
  }

  const weekStart = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const tasksByDay = days.map((day) => tasks.filter((t) => sameDay(new Date(t.createdAt), day)));

  const byStatus = new Map<string, CalendarTask[]>([
    ["unset", []],
    ...STATUSES.map((s): [string, CalendarTask[]] => [s.id, []]),
  ]);
  for (const t of tasks) {
    const key = t.status && byStatus.has(t.status) ? t.status : "unset";
    byStatus.get(key)!.push(t);
  }

  return (
    <>
      <div className="calendar-week">
        {days.map((day, i) => (
          <div key={i} className="calendar-day">
            <p className="eyebrow calendar-day-header">
              {DAY_LABELS[i]} <span className="calendar-day-date">{day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </p>
            <div className="calendar-day-cards">
              {tasksByDay[i].length === 0 && <p className="panel-empty">—</p>}
              {tasksByDay[i].map((task) => (
                <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="eyebrow" style={{ marginTop: 32 }}>Board</p>
      <h2 style={{ margin: "0 0 16px" }}>By status</h2>
      <div className="kanban-board">
        {["unset", ...STATUSES.map((s) => s.id)].map((statusId) => (
          <div key={statusId} className="kanban-column panel">
            <p className="eyebrow">
              {statusId === "unset" ? "Unset" : STATUSES.find((s) => s.id === statusId)!.label} ({byStatus.get(statusId)!.length})
            </p>
            {byStatus.get(statusId)!.length === 0 && <p className="panel-empty">Nothing here.</p>}
            <div className="calendar-day-cards">
              {byStatus.get(statusId)!.map((task) => (
                <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
