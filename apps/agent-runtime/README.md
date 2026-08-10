# apps/agent-runtime

The actual agent runtime, built on [`eve`](https://eve.dev/docs). Every
department's agent definition, tools, connections, and schedules live here.

**Read the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md)'s "eve
directory-discovery convention" section before adding or moving a file** —
subagents/tools/connections/schedules are discovered by their exact
directory location, not a registry file, so a misplaced file fails
silently (no compile error).

```bash
cp .env.example .env   # fill in real values
npm run dev            # eve dev
npm run typecheck
```

## Layout

- `agent/agent.ts` + `instructions*.ts` — the root agent, the one a
  dashboard chat session actually starts with; it delegates to department
  subagents.
- `agent/subagents/<dept>/` — one folder per department, each
  `{agent.ts, instructions.ts, instructions.default.ts, tools/, hooks/}`
  (+ optionally `connections/`, + optionally nested `subagents/` for a
  department that delegates further, e.g. `swe-lead`).
- `agent/schedules/` — proactive, cron-triggered flows (root-only in eve).
- `agent/channels/` — how a session gets started (the default HTTP-inbound
  `eve.ts` channel, plus minimal `receive`-only channels used by
  schedules).
- `agent/lib/` — shared helpers used across departments: connection token
  resolvers (`github-connection-auth.ts`, `google-calendar-connection-auth.ts`,
  `twilio-call.ts`), `memory-tools.ts` (cross-session memory), `resolve-instructions.ts`
  (per-org prompt override + memory injection), `s3-client.ts`, `log-tool-result.ts`.
- `agent/hooks/` — eve lifecycle hooks (activity logging).
