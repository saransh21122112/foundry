# packages/shared-types

Enums and types shared by every other package — the one file
(`src/index.ts`) both `packages/db`'s schema and `packages/guardrails`'s
logic are built against, so they can never drift apart.

```bash
npm run typecheck
```

## Contents (`src/index.ts`)

- `DEPARTMENTS` — the 8 top-level departments. Adding a new one means
  adding it here, to `packages/db/src/schema.ts`'s `department` enum, and
  building the actual `apps/agent-runtime/agent/subagents/<dept>/` folder
  (see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md)).
- `AUTONOMY_LEVELS` — `off` / `draft_only` / `bounded_autonomous`.
- `RISK_CLASSES` — including `irreversible`/`financial`/`legal`, the ones
  `packages/guardrails`'s `HARD_RULE_RISK_CLASSES` always routes to human
  approval.
- `KNOWN_TOOLS` — hand-maintained registry of every tool declared under
  `apps/agent-runtime/agent/subagents/<dept>/tools/`, with its `riskClass`
  and whether it's `gated`. No dynamic discovery yet — update this
  whenever a tool file is added, or the dashboard's tool-allowlist page
  won't know about it.
