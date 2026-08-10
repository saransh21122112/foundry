# infra

AWS CDK (TypeScript) — the entire deployed stack: ECS/Fargate (`apps/web`),
EC2-backed ECS (`apps/agent-runtime`, needs the Docker socket for
sandboxes), RDS Postgres, one shared ALB, ECR repos, IAM roles (including
the GitHub Actions OIDC deploy roles), Secrets Manager.

`lib/foundry-stack.ts` is the entire stack, in one file — read it directly
rather than trusting a summary; it's the actual source of truth for what's
deployed, including the exact env vars/secrets each container gets.

```bash
npm run typecheck
npm run synth   # cdk synth — render the CloudFormation template, no AWS calls
npm run diff    # cdk diff — compare against what's actually deployed
```

Do not run `npm run deploy` (`cdk deploy`) directly except for the
one-time bootstrap step — see [`DEPLOY.md`](../DEPLOY.md), normal deploys
go through `.github/workflows/deploy.yml`.

## Layout

- `bin/infra.ts` — CDK app entry point, instantiates the stack.
- `lib/foundry-stack.ts` — everything: networking, database, both ECS
  services, the ALB and its routing rules, IAM, secrets.
- `cdk.json`, `cdk.context.json` — CDK's own config/context cache.

## Deploying a second, org-specific stack

The stack takes an `orgName` CDK context value (`FoundryStackProps.orgName`,
read via `this.node.tryGetContext("orgName")` if not passed as a prop).
It defaults to `"default"` — the original shared stack — so every existing
command (`npm run synth`/`diff`/`deploy`, the `deploy-infra` CI job) is
unaffected.

Passing a different `orgName` gets you an independent copy of the same
one-VPC/RDS/ECS/ALB shape, safe to deploy into the same AWS account
alongside the default stack: the CloudFormation stack id becomes
`FoundryStack-<orgName>`, and every resource whose name would otherwise
collide (RDS instance identifier, S3 bucket, Secrets Manager paths, ECS
cluster name, ALB name) gets an `-<orgName>` suffix or `/<orgName>/`
segment. See DEPLOY.md for the full picture, including what's deliberately
*not* duplicated per org (the GitHub OIDC/CI roles).

```bash
cd infra
npx cdk deploy --context orgName=acme-co --require-approval never
```

This is a manual, per-customer `cdk deploy` — not automated self-service
provisioning. Run it by hand for each org that needs its own stack.
