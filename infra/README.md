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
