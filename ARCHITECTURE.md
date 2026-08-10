# Architecture

The mental model a new contributor needs before touching code. If this
disagrees with the actual code, trust the code and fix this file.

## The two runtimes

```
                         ┌─────────────────────────┐
   browser  ───────────▶ │   ALB (infra, port 80)  │
                         └───────────┬─────────────┘
                                     │
                  ┌──────────────────┼───────────────────┐
                  │ default route    │ /eve/*,
                  │                  │ /.well-known/workflow/*
                  ▼                  ▼
        ┌───────────────────┐  ┌──────────────────────────┐
        │  apps/web          │  │  apps/agent-runtime       │
        │  Next.js, Fargate  │─▶│  eve runtime, EC2-backed  │
        │  dashboard + authz │  │  ECS (needs the Docker    │
        │  + Stripe billing  │  │  socket for sandboxes)    │
        └─────────┬──────────┘  └─────────────┬─────────────┘
                  │                            │
                  └────────────┬───────────────┘
                               ▼
                    packages/db (Drizzle / RDS Postgres)
```

Both apps read/write the **same** Postgres database directly via
`packages/db` — there's no API layer between them and the data. `apps/web`
calls into `apps/agent-runtime` over HTTP (`apps/web/lib/eve-client.ts`,
`AGENT_RUNTIME_URL`) to start/resume agent sessions; `apps/agent-runtime`
never calls back into `apps/web`.

`infra/lib/foundry-stack.ts` is the source of truth for this routing — one
ALB, one listener, path-based routing sends `/eve/*` and
`/.well-known/workflow/*` to agent-runtime *without* rewriting the path
(both routes must reach agent-runtime verbatim), everything else goes to
the web app.

## The eve directory-discovery convention (read this before adding a file)

`apps/agent-runtime` is built on the `eve` framework, which discovers
subagents, tools, connections, and schedules **by their exact directory
location** — there is no separate registry file to edit for any of these.
This is the one rule that most affects "where do I add X," and the one
thing that makes moving files here a real behavior risk, not just cosmetic
refactor — a misplaced file fails silently (no compile error), it just
never gets discovered.

- **A new department** (top-level, chat-reachable): a new folder under
  `agent/subagents/<dept>/` with the standard shape:
  `agent.ts` (model + description), `instructions.ts` + `instructions.default.ts`
  (system prompt, resolved per-org via `agent/lib/resolve-instructions.ts`),
  `tools/`, and optionally `hooks/`. Copy an existing department (e.g.
  `ops-manager/`) as the template. Also register it in
  `packages/shared-types/src/index.ts`'s `DEPARTMENTS` array and
  `KNOWN_TOOLS`, and in the DB's `department` enum
  (`packages/db/src/schema.ts`).
- **A new tool** for an existing department: a file in
  `agent/subagents/<dept>/tools/`. It is *only* reachable by that
  department — declared subagents inherit nothing from the root or from
  sibling departments by default. Register it in `KNOWN_TOOLS` too
  (`packages/shared-types/src/index.ts`) so the dashboard's tool-allowlist
  page knows about it.
- **A new connection** (OAuth-backed third-party API, e.g. GitHub, Google
  Calendar): a file in `agent/subagents/<dept>/connections/`. Same
  per-department reachability rule as tools.
- **A nested sub-specialist** (a department that itself delegates to
  narrower agents, e.g. `swe-lead` → `frontend-developer`/
  `backend-developer`/`ui-ux-designer`): `agent/subagents/<dept>/subagents/<name>/`,
  same 4-file shape as a top-level department.
- **A new schedule** (proactive, cron-triggered): a file in
  `agent/schedules/`. Schedules are root-only in eve — there's no
  per-department schedule concept. See `chief-of-staff-briefing.ts` for the
  fan-out-per-org pattern every schedule here follows.

**Copy an existing, similar file as your starting point** rather than
writing a tool/connection/schedule from scratch — the patterns below are
proven, not incidental:
- Ungated read tool: `agent/subagents/ops-manager/tools/get_call_result.ts`
- Gated tool with a real side effect: `agent/subagents/ops-manager/tools/place_call.ts`
- OAuth-backed connection: `agent/subagents/eng-lead/connections/github.ts`
- Cross-session memory read/write: `agent/lib/memory-tools.ts`

## Guardrails: the enforcement path every gated tool call goes through

`packages/guardrails/src/enforce.ts` is the actual source of truth for
autonomy/budget/approval logic — read it directly rather than trusting a
restatement here that can drift out of sync. The short version: every tool
call declared with an `approval:` field (via `makeApprovalPolicy`, see the
"gated tool" example above) is checked, in order, against: kill switch →
department enabled → autonomy level → hard-rule risk classes
(`irreversible`/`financial`/`legal` — see `HARD_RULE_RISK_CLASSES` in
`enforce.ts`, these **always** require human approval regardless of
autonomy level) → tool allowlist → budget cap → rate limit. A denial either
blocks outright or parks the call as a pending row in `approval_requests`
for a human to resolve at `/dashboard/approvals`. Every outcome is logged
to `activity_log` (`packages/db/src/schema.ts`), which backs
`/dashboard/activity`, `/dashboard/graph`, `/dashboard/kpis`, and
`/dashboard/compliance`.

A tool with **no** `approval:` field skips this whole path — reserved for
pure reads with no side effect (see `riskClass: "reversible-low"`,
`gated: false` entries in `KNOWN_TOOLS`).

## Deployment model: single-tenant per deployment

Foundry's primary distribution model is self-hosted, single-tenant: each
organization deploys its own instance into its own AWS account (see
[`DEPLOY.md`](./DEPLOY.md) §1, `infra/lib/foundry-stack.ts`'s `orgName` CDK
context). A given deployment normally serves exactly one org.

The DB schema (`packages/db/src/schema.ts`) is nonetheless `orgId`-scoped
throughout, as if built for shared multi-tenancy. That's kept intentionally,
not stale leftover:

- It's harmless in the single-org case — every row just carries the same
  `orgId`.
- It still supports an operator who deliberately chooses to run one shared
  instance for multiple orgs themselves (see `DEPLOY.md` §6, "Extending an
  existing shared instance").

But it is no longer load-bearing for the product's *default* distribution
model — don't read the multi-tenant schema as a signal that a shared,
centrally-operated deployment is the intended way to run Foundry. It isn't;
self-hosted single-tenant is.

## Persistent memory & proactive schedules

- **Cross-session memory**: `agent_memories` table
  (`packages/db/src/schema.ts`), written/read by the shared
  `remember`/`recall`/`forget` tools (`agent/lib/memory-tools.ts`, one thin
  wrapper per department in each `tools/` dir), injected into every new
  session's instructions by `agent/lib/resolve-instructions.ts`'s
  `session.started` hook. Scoped to the department root — a nested
  sub-specialist shares its parent department's memory, not its own.
- **Proactive schedules**: `agent/schedules/`, root-only. Each one fans out
  per-org (`db.select from organizations`, `Promise.allSettled`), calls
  `receive()` to start a real durable session, and indexes it into
  `run_sessions` so it shows up in the normal `/dashboard/run` task list —
  no separate UI needed for a new scheduled briefing.

## Where things live, if you're looking for X

| You want to... | Look at |
|---|---|
| Change dashboard UI/pages | `apps/web/app/dashboard/<page>/page.tsx` |
| Change what an agent can do | `apps/agent-runtime/agent/subagents/<dept>/tools/` |
| Change autonomy/budget/approval rules | `packages/guardrails/src/enforce.ts` |
| Change the DB schema | `packages/db/src/schema.ts`, then `npm run generate` in `packages/db` |
| Change a shared enum/type (departments, risk classes) | `packages/shared-types/src/index.ts` |
| Change AWS infra (ECS, ALB, secrets) | `infra/lib/foundry-stack.ts` |
| Change CI/deploy | `.github/workflows/{ci,deploy,e2e}.yml`, `DEPLOY.md` |
| Add an E2E test | `e2e/tests/`, see `e2e/README.md` |

See each package's own `README.md` for a shorter, local version of this
table.
