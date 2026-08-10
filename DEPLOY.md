# Deploy runbook

Foundry runs on AWS ECS/Fargate behind an ALB: `apps/web` (Next.js, Fargate),
`apps/agent-runtime` (eve runtime, EC2-backed ECS service — it drives the
host Docker daemon for sandboxes, so it can't run on Fargate), and a Postgres
RDS instance migrated via a one-off Fargate task (`foundry-db-migrate`).

Foundry is self-hosted: you deploy your own instance into your own AWS
account. This doc covers: deploying your own instance (the primary path),
the normal push-to-deploy flow once it's set up, the manual fallback, infra
changes, rollback, and — as secondary content — extending an existing
shared instance if you're running Foundry as one operator serving multiple
orgs.

## 1. Deploy your own instance

`infra/lib/foundry-stack.ts` takes an `orgName` CDK context value (default
`"default"`). Passing your own org name deploys an independent copy of the
whole architecture (VPC, RDS, ECS, ALB) into your AWS account, with every
resource name scoped to that org — no collisions with any other stack,
including someone else's instance in a different account or a second
instance of your own:

```bash
cd infra
npx cdk deploy --context orgName=acme-co --require-approval never
```

This creates stack `FoundryStack-acme-co` with its own RDS instance
(`foundry-acme-co-db`), S3 bucket (`foundry-project-files-acme-co-<account>`),
Secrets Manager entries (`foundry/acme-co/db-credentials`,
`foundry/acme-co/app-secrets`), ECS cluster (`foundry-acme-co-cluster`), and
ALB (`foundry-acme-co`). It reuses the **same** ECR repos (`foundry-web`,
`foundry-agent-runtime`, `foundry-db-migrate`) as every other stack — one
codebase, N infra copies, not a per-org build.

See `infra/README.md` for the mechanism (`orgName` context/prop, defaulting
behavior) in more detail.

### Setting up your instance's deploy pipeline

Do these once, in order, so GitHub Actions can deploy on your behalf. Steps
1-2 need a human with real AWS/GitHub access — Claude Code's own permission
classifier blocks interactive `cdk deploy`.

1. **Create the OIDC provider + IAM roles** (from a real terminal, not
   Claude Code):
   ```bash
   cd infra
   npx cdk deploy --require-approval never
   ```
   This creates `GithubOidcProvider`, `GithubDeployRole` (used by the
   `deploy-app` job — ECR push, ECS run-task/update-service), and
   `GithubCdkDeployRole` (used by `deploy-infra` — broader, can run `cdk
   deploy` itself). These are account-level singletons tied to your one
   GitHub repo/CI pipeline — you create them once, not once per org, even
   if you later deploy multiple org-scoped stacks into the same account
   (see "Deploying a second, org-specific stack" below).

2. **Copy the two new CDK outputs into GitHub as secrets.** The deploy
   finishes by printing `GithubDeployRoleArn` and `GithubCdkDeployRoleArn`.
   Go to Settings → Secrets and variables → Actions → **Secrets** and add:
   - `AWS_DEPLOY_ROLE_ARN` = `GithubDeployRoleArn` output
   - `AWS_CDK_DEPLOY_ROLE_ARN` = `GithubCdkDeployRoleArn` output

3. **Set these repo variables** (Settings → Secrets and variables → Actions
   → Variables):
   - `AWS_REGION`, `ECS_CLUSTER_ARN`, `WEB_SERVICE_NAME`,
     `AGENT_SERVICE_NAME`, `MIGRATE_SUBNET_IDS`,
     `MIGRATE_SECURITY_GROUP_ID`, `BASE_URL`, `CLERK_PUBLISHABLE_KEY`

4. **Set these secrets:**
   - `CLERK_SECRET_KEY` as a GitHub **secret** — the value lives in AWS
     Secrets Manager under `foundry/app-secrets` once you've set up Clerk;
     copy it over.
   - The e2e-specific setup in `e2e/README.md`: seed a Clerk test user and
     set the `E2E_CLERK_USER_EMAIL` / `E2E_CLERK_USER_PASSWORD` secrets.
     Don't duplicate that here — see that file.

5. **Optional:** `SLACK_WEBHOOK_URL` secret, for e2e failure notifications
   (`.github/workflows/e2e.yml` posts to it on failure if set).

6. **Optional, for the Google Calendar connection** (`/dashboard/connections`):
   add `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` as keys in
   the `foundry/app-secrets` Secrets Manager secret (both apps' task
   definitions already read them — see `infra/lib/foundry-stack.ts`).
   Register an OAuth 2.0 Client ID in Google Cloud Console, enable the
   Calendar API, and add `<BASE_URL>/dashboard/connections/google-calendar/callback`
   as an authorized redirect URI. `GITHUB_TOKEN_ENCRYPTION_KEY` (already set)
   is reused to encrypt the Google token too — no separate key needed.

7. **Optional, for the voice phone-call agent** (`place_call`/`get_call_result`
   tools, ops-manager): add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
   `TWILIO_FROM_NUMBER` (a Twilio phone number capable of outbound calls) as
   keys in `foundry/app-secrets`. Requires a real Twilio account and a
   purchased phone number — a paid third-party signup only a human can
   complete, no infra/code work unblocks it. These are your instance's own
   credentials — every org on your instance places calls through the same
   number and bills to the same account, worth revisiting if you run one
   shared instance for multiple orgs. Without these set, `place_call` fails
   with a clear "not configured" error rather than a crash.

8. **Optional, for the Telegram channel** (`agent/channels/telegram.ts`):
   create a bot via [@BotFather](https://t.me/BotFather) (`/newbot`), add
   `TELEGRAM_BOT_TOKEN`, a random `TELEGRAM_WEBHOOK_SECRET_TOKEN` (any
   long random string — eve checks it on every inbound webhook), and
   `TELEGRAM_BOT_USERNAME` (no `@`, shown on `/dashboard/connections`) to
   `foundry/app-secrets`. Then register the webhook once (eve doesn't do
   this itself):
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=<BASE_URL>/eve/v1/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET_TOKEN>"
   ```
   One bot per instance (same model as Twilio) — an org on your instance
   links its own chat via a short-lived code from `/dashboard/connections`,
   not a per-org bot token.

9. **`exec_host` (direct host execution, `eng-lead`) — the standard setting
   for a self-hosted deployment**, since a self-hosted instance normally
   belongs to exactly one org. Set `ALLOW_HOST_EXEC=true` in the
   agent-runtime container's environment (`infra/lib/foundry-stack.ts`).
   Without this var set, `exec_host` throws a clear "not enabled" error
   rather than running — this is a real runtime gate, not just
   documentation, since eve discovers tool files by directory location
   regardless of which deployment runs the code. If you're running one
   shared instance for multiple orgs yourself (see "Extending an existing
   shared instance" below), leave it unset — this still-approval-gated tool
   (`riskClass: "reversible-high"`) runs on the container host itself, not
   an isolated per-org sandbox. Still approval-gated like every other real
   side-effecting tool either way — enabling host exec doesn't disable
   guardrails, it only changes where the command runs.

Once bootstrap is done, populate your instance's `app-secrets` Secrets
Manager entry (same `REPLACE_ME` fields as the default stack, see
`infra/lib/foundry-stack.ts`), then push images and run the migration using
the manual sequence in section 3 below, pointed at your stack's own
cluster/services/subnets (its `CfnOutput`s give you the ARNs) — or just
`git push origin main` once the pipeline is wired up (section 2).

## 2. Normal deploy

Once your instance's pipeline is set up:

```bash
git push origin main
```

`deploy.yml` runs automatically:

1. **`test`** — `npm ci`, typecheck, test. Everything downstream waits on
   this passing.
2. **`deploy-app`** (needs `test`) — assumes `AWS_DEPLOY_ROLE_ARN` via OIDC,
   logs into ECR, builds and pushes all three images
   (`foundry-web`, `foundry-agent-runtime`, `foundry-db-migrate`) with
   `--platform linux/amd64` explicitly set, runs the migration as a one-off
   `foundry-db-migrate` Fargate task and waits for it to stop (fails the job
   if its exit code isn't 0), then force-redeploys both ECS services
   (`update-service --force-new-deployment`) and waits for
   `services-stable`.
3. **`deploy-infra`** (needs `test` + the `changes` path filter) — only
   runs if the push touched `infra/**`. Assumes
   `AWS_CDK_DEPLOY_ROLE_ARN` and runs `cdk deploy --require-approval never`
   from `infra/`.

`e2e.yml` then runs automatically against the live deployment
(`workflow_run` trigger on `Deploy` completing), on top of its 6-hourly
schedule and manual dispatch.

**Callout — `--platform linux/amd64`:** every image build sets this
explicitly. Docker Desktop on Apple Silicon defaults to `arm64`, which
silently broke Fargate/EC2 task placement twice during manual deploys this
session (task defs are amd64; an arm64 image just fails to start). Don't
drop this flag in any manual build either — see below.

## 3. Manual fallback

Only if GitHub Actions is down or you need to deploy from a laptop. This is
the same sequence `deploy-app` runs — treat it as the fallback, not the
primary path.

```bash
# 0. Vars — fill from the GitHub repo variables listed above, or verify live with:
#    aws ecs describe-services --cluster <cluster-arn> --services <web-service> <agent-service>
REGISTRY=<account-id>.dkr.ecr.<region>.amazonaws.com
CLUSTER=<ECS_CLUSTER_ARN>
WEB_SERVICE=<WEB_SERVICE_NAME>
AGENT_SERVICE=<AGENT_SERVICE_NAME>
SUBNETS=<MIGRATE_SUBNET_IDS>            # comma-separated
SG=<MIGRATE_SECURITY_GROUP_ID>
CLERK_PUBLISHABLE_KEY=<pk_...>          # baked into the web bundle at build time

# 1. Auth to ECR
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin "$REGISTRY"

# 2. Build each image — from the monorepo root, --platform linux/amd64 always
docker build --platform linux/amd64 -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" \
  -t "$REGISTRY/foundry-web:latest" .

docker build --platform linux/amd64 -f apps/agent-runtime/Dockerfile \
  -t "$REGISTRY/foundry-agent-runtime:latest" .

docker build --platform linux/amd64 -f packages/db/Dockerfile.migrate \
  -t "$REGISTRY/foundry-db-migrate:latest" .

# 3. Push
docker push "$REGISTRY/foundry-web:latest"
docker push "$REGISTRY/foundry-agent-runtime:latest"
docker push "$REGISTRY/foundry-db-migrate:latest"

# 4. Run the migration as a one-off Fargate task (RDS has no route from
#    outside the VPC, so this must run inside it — not from your laptop)
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --task-definition foundry-db-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --query "tasks[0].taskArn" --output text)

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query "tasks[0].containers[0].exitCode" --output text)
echo "migration exit code: $EXIT_CODE"   # must be 0 before continuing

# 5. Force-redeploy both services and wait for stability
aws ecs update-service --cluster "$CLUSTER" --service "$WEB_SERVICE" --force-new-deployment
aws ecs update-service --cluster "$CLUSTER" --service "$AGENT_SERVICE" --force-new-deployment
aws ecs wait services-stable --cluster "$CLUSTER" --services "$WEB_SERVICE" "$AGENT_SERVICE"
```

Do not skip the exit-code check in step 4 — a failed migration followed by a
service redeploy just puts new app code in front of a half-migrated
database.

## 4. Infra changes

`infra/lib/foundry-stack.ts` defines the VPC, cluster, both ECS
services/task defs, the ALB, RDS, and the GitHub OIDC provider and deploy
roles.

- **Normal path:** just include the `infra/` change in your push to `main`.
  `deploy.yml`'s `deploy-infra` job triggers automatically off the
  `dorny/paths-filter` check on `infra/**` and runs `cdk deploy` for you,
  using the more-privileged `AWS_CDK_DEPLOY_ROLE_ARN`.
- **Run `cdk deploy` manually** only for the initial pipeline bootstrap
  above (the OIDC provider/roles have to exist before the pipeline can
  assume them — chicken-and-egg), or if you need to inspect a `cdk diff`
  before pushing, or if `deploy-infra` fails and you're debugging from a
  terminal with your own AWS credentials.

## 5. Rollback

**Bad app deploy (web or agent-runtime):** ECS keeps prior task definition
revisions. Roll back fast with:

```bash
aws ecs update-service --cluster "$CLUSTER" --service "$WEB_SERVICE" \
  --task-definition <previous-task-def-arn-or-family:revision>
aws ecs wait services-stable --cluster "$CLUSTER" --services "$WEB_SERVICE"
```

Find the previous revision with `aws ecs list-task-definitions --family-prefix foundry-web`
(or the agent-runtime family) or from the ECS console's service deployment
history. Repeat for `AGENT_SERVICE` if needed.

**Bad migration:** there is no automatic reversal. `packages/db/migrations/`
contains only forward `*.sql` files (`0000_...sql` through `0010_...sql`)
plus Drizzle's own snapshot metadata under `migrations/meta/` — no
down-migration files or convention exist in this repo. If a migration is
bad:

- If it hasn't shipped broken app code yet, the fastest fix is usually a
  new forward migration that corrects the problem, not an attempt to undo
  the last one.
- If a bad migration already went out alongside app code that depends on
  it, rolling back the ECS service to a previous task definition does
  **not** undo the schema change — the old app code will now be running
  against a newer schema. Assess compatibility before rolling back the
  service alone; you may need to roll forward with a fix instead.
- Take an RDS snapshot/backup before attempting any manual schema surgery.
  This repo has no documented restore procedure — treat that as a gap, not
  a solved problem.

## 6. Extending an existing shared instance

Most self-hosters only need section 1. This section is for the less common
case: you're running one Foundry instance as an operator serving multiple
orgs yourself, and want to add another org-scoped stack to an AWS account
that already has a Foundry instance (and its OIDC provider/deploy roles) set
up.

The `orgName` mechanism from section 1 already isolates the new stack —
```bash
cd infra
npx cdk deploy --context orgName=acme-co --require-approval never
```
— so nothing about the deploy command changes. What's different is that you
skip the pipeline bootstrap (the OIDC provider and
`foundry-deploy`/`foundry-cdk-deploy` IAM roles are account-level
singletons your existing instance already created — don't recreate them):

**What this does NOT create:** the GitHub OIDC provider and the
`foundry-deploy`/`foundry-cdk-deploy` IAM roles. A second org's stack on an
account that already has an instance is a manual `cdk deploy` you run
yourself (as above), not a new automated pipeline, so it has no use for its
own copy of them.

After the stack is up: populate its `foundry/acme-co/app-secrets` Secrets
Manager entry by hand (same `REPLACE_ME` fields as the default stack, see
`infra/lib/foundry-stack.ts`), then push images and run the migration
against it using the manual sequence in section 3 above, pointed at this
stack's own cluster/services/subnets (its `CfnOutput`s give you the ARNs).

This is manual, per-org provisioning, not self-service — there is no UI or
automation that creates a new org's stack on signup. See `infra/README.md`
for the mechanism (`orgName` context/prop, defaulting behavior) in more
detail.
