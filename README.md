# Foundry

Foundry is a self-hosted "AI company" — deploy your own instance into your
own AWS account and every department (engineering, product, research, ops,
design, data, sales, software engineering) runs as an agent inside
guardrails you control (autonomy level, budget caps, kill switch, tool
allowlist). Same distribution model as OpenClaw: clone the repo, deploy your
own instance, you own the infrastructure and the data.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the pieces fit together
and where to add new code — read that before making a non-trivial change.

## Deploy your own instance

The primary path is a single `cdk deploy` into your own AWS account, scoped
to your org name so it never collides with anyone else's stack (including a
second instance of your own, if you ever want one):

```bash
git clone <this-repo>
cd foundry/infra
npm install
npx cdk deploy --context orgName=<your-org> --require-approval never
```

This provisions the whole stack under your account — VPC, ECS/Fargate
(`apps/web`), EC2-backed ECS (`apps/agent-runtime`), RDS Postgres, ALB, ECR
repos, Secrets Manager, IAM. Nothing is shared with any other deployment;
resource names are suffixed with `<your-org>` so it's safe to run alongside
other stacks in the same account.

### One-time setup for your instance

Before the pipeline can deploy on your behalf, do this once from a real
terminal (not Claude Code — its permission classifier blocks interactive
`cdk deploy`):

1. **Create the OIDC provider + IAM roles** so GitHub Actions can deploy
   into your AWS account:
   ```bash
   cd infra
   npx cdk deploy --require-approval never
   ```
   This creates `GithubOidcProvider`, `GithubDeployRole` (ECR push, ECS
   run-task/update-service), and `GithubCdkDeployRole` (broader — can run
   `cdk deploy` itself).

2. **Copy the two CDK outputs into your repo's GitHub secrets**
   (`AWS_DEPLOY_ROLE_ARN`, `AWS_CDK_DEPLOY_ROLE_ARN`) from the
   `GithubDeployRoleArn` / `GithubCdkDeployRoleArn` outputs the deploy
   prints.

3. **Set the remaining repo variables and secrets** your instance needs —
   AWS region, ECS cluster/service names, Clerk keys, and any optional
   integrations (Google Calendar, Twilio, Telegram). Full list and exact
   steps in [`DEPLOY.md`](./DEPLOY.md).

Once that's done, `git push origin main` triggers a full automated deploy of
your instance via `.github/workflows/deploy.yml`. See
[`DEPLOY.md`](./DEPLOY.md) for the normal deploy path, the manual fallback,
and rollback.

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

## Other docs

- [`ROADMAP.md`](./ROADMAP.md) — what's built, what's next.
- [`e2e/README.md`](./e2e/README.md) — E2E test setup (seeding a test user, required secrets).
