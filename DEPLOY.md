# Deploy runbook

Foundry runs on AWS ECS/Fargate behind an ALB: `apps/web` (Next.js, Fargate),
`apps/agent-runtime` (eve runtime, EC2-backed ECS service — it drives the
host Docker daemon for sandboxes, so it can't run on Fargate), and a Postgres
RDS instance migrated via a one-off Fargate task (`foundry-db-migrate`).

Deploys are automated by `.github/workflows/deploy.yml` on every push to
`main`. This doc covers: one-time bootstrap, the normal path, the manual
fallback, infra changes, and rollback.

## 1. One-time bootstrap

Do these once, in order, before the pipeline is self-sufficient. Steps 1-2
need a human with real AWS/GitHub access — Claude Code's own permission
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
   deploy` itself). Not yet run against AWS as of this session.

2. **Copy the two new CDK outputs into GitHub as secrets.** The deploy
   finishes by printing `GithubDeployRoleArn` and `GithubCdkDeployRoleArn`.
   Go to Settings → Secrets and variables → Actions → **Secrets** and add:
   - `AWS_DEPLOY_ROLE_ARN` = `GithubDeployRoleArn` output
   - `AWS_CDK_DEPLOY_ROLE_ARN` = `GithubCdkDeployRoleArn` output

3. **Already done this session** — these repo **variables** (Settings →
   Secrets and variables → Actions → Variables) are already set, nothing to
   do here:
   - `AWS_REGION`, `ECS_CLUSTER_ARN`, `WEB_SERVICE_NAME`,
     `AGENT_SERVICE_NAME`, `MIGRATE_SUBNET_IDS`,
     `MIGRATE_SECURITY_GROUP_ID`, `BASE_URL`, `CLERK_PUBLISHABLE_KEY`

4. **Still needed:**
   - `CLERK_SECRET_KEY` as a GitHub **secret** — the value already lives in
     AWS Secrets Manager under `foundry/app-secrets`, just copy it over.
   - The e2e-specific setup in `e2e/README.md`: seed a Clerk test user and
     set the `E2E_CLERK_USER_EMAIL` / `E2E_CLERK_USER_PASSWORD` secrets.
     Don't duplicate that here — see that file.

5. **Optional:** `SLACK_WEBHOOK_URL` secret, for e2e failure notifications
   (`.github/workflows/e2e.yml` posts to it on failure if set).

## 2. Normal deploy

Once bootstrap is done:

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
services/task defs, the ALB, RDS, and (as of this session) the GitHub OIDC
provider and deploy roles.

- **Normal path:** just include the `infra/` change in your push to `main`.
  `deploy.yml`'s `deploy-infra` job triggers automatically off the
  `dorny/paths-filter` check on `infra/**` and runs `cdk deploy` for you,
  using the more-privileged `AWS_CDK_DEPLOY_ROLE_ARN`.
- **Run `cdk deploy` manually** only for the bootstrap step above (the
  OIDC provider/roles have to exist before the pipeline can assume them —
  chicken-and-egg), or if you need to inspect a `cdk diff` before pushing,
  or if `deploy-infra` fails and you're debugging from a terminal with your
  own AWS credentials.

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
