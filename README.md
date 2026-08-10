# Foundry

Multi-tenant SaaS version of an "AI company" — every signed-up org gets its
own virtual company of department agents (engineering, product, research,
ops, design, data, sales, software engineering), each running within
guardrails the org itself controls (autonomy level, budget caps, kill
switch, tool allowlist).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the pieces fit together
and where to add new code — read that before making a non-trivial change.

## Layout

A Turborepo monorepo (`npm` workspaces + `turbo`):

| Path | What it is |
|---|---|
| `apps/web` | Next.js dashboard — auth, org/department settings, approvals, billing. See [`apps/web/README.md`](./apps/web/README.md). |
| `apps/agent-runtime` | The actual agent runtime, built on `eve`. Department subagents, tools, connections, schedules. See [`apps/agent-runtime/README.md`](./apps/agent-runtime/README.md). |
| `packages/db` | Drizzle schema + migrations, shared by both apps. See [`packages/db/README.md`](./packages/db/README.md). |
| `packages/guardrails` | Autonomy/budget/approval enforcement — the code every gated tool call runs through. See [`packages/guardrails/README.md`](./packages/guardrails/README.md). |
| `packages/shared-types` | Enums/types shared by every other package (departments, risk classes, `KNOWN_TOOLS`). See [`packages/shared-types/README.md`](./packages/shared-types/README.md). |
| `infra` | AWS CDK — ECS/Fargate, ALB, RDS, ECR, IAM, Secrets Manager. See [`infra/README.md`](./infra/README.md). |
| `e2e` | Playwright suite against the real deployed stack. See [`e2e/README.md`](./e2e/README.md). |
| `legal` | Static privacy policy / terms of service markdown, served by `apps/web`. |

## Running locally

```bash
npm install
```

Each package needs its own env file — copy the `.env.example` in
`apps/web/`, `apps/agent-runtime/`, and `packages/db/` to `.env.local` /
`.env` and fill in real values (see each file's comments for what each
variable is and where it comes from).

Then, from the repo root:

```bash
npm run dev         # turbo run dev — starts apps/web and apps/agent-runtime together
npm run typecheck   # turbo run typecheck — every package
npm run test        # turbo run test — packages/db, packages/guardrails, apps/web unit tests
```

Or run a single package's script directly, e.g. `cd apps/web && npm run dev`.

## Deploying

Fully automated by `.github/workflows/deploy.yml` on push to `main`. See
[`DEPLOY.md`](./DEPLOY.md) for the one-time bootstrap steps, the normal
deploy path, the manual fallback, and rollback.

## Other docs

- [`ROADMAP.md`](./ROADMAP.md) — what's built, what's next.
- [`e2e/README.md`](./e2e/README.md) — E2E test setup (seeding a test user, required secrets).
