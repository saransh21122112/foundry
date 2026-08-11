import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as rds from "aws-cdk-lib/aws-rds";
import * as efs from "aws-cdk-lib/aws-efs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";

// RDS's auto-generated Secrets Manager entry has no single connection-string
// field, only discrete fields (host/port/dbname/username/password) — inject
// those as PG* env vars, which `pg`'s Pool reads natively with no config.
function dbConnectionSecrets(database: rds.DatabaseInstance): Record<string, ecs.Secret> {
  const secret = database.secret!;
  return {
    PGHOST: ecs.Secret.fromSecretsManager(secret, "host"),
    PGPORT: ecs.Secret.fromSecretsManager(secret, "port"),
    PGDATABASE: ecs.Secret.fromSecretsManager(secret, "dbname"),
    PGUSER: ecs.Secret.fromSecretsManager(secret, "username"),
    PGPASSWORD: ecs.Secret.fromSecretsManager(secret, "password"),
  };
}

export interface FoundryStackProps extends cdk.StackProps {
  // Which org/customer this deployment is for. Falls back to context (so
  // `cdk synth --context orgName=x` works even without touching bin/infra.ts)
  // and finally to "default" — the identity of the original shared stack.
  // Every physical resource name below only gets an org suffix/segment when
  // this is NOT "default", so the existing default deployment's resources
  // keep their exact current names (no accidental replacement).
  orgName?: string;
}

export class FoundryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: FoundryStackProps) {
    super(scope, id, props);

    const orgName =
      props?.orgName ?? (this.node.tryGetContext("orgName") as string | undefined) ?? "default";
    // Trust-boundary check: orgName ends up in AWS resource names (S3 bucket,
    // RDS identifier, IAM role, Secrets Manager path) with tight charset
    // rules — fail fast with a clear error rather than a confusing AWS
    // validation error mid-deploy.
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(orgName)) {
      throw new Error(
        `orgName "${orgName}" is invalid — must start with a lowercase letter and contain only ` +
          `lowercase letters, digits, and hyphens (max 31 chars).`,
      );
    }
    const isDefault = orgName === "default";
    cdk.Tags.of(this).add("foundry:org", orgName);

    // --- Networking -------------------------------------------------
    // Single NAT instance (t3.nano, ~$3/mo) instead of a managed NAT Gateway
    // (~$32/mo) — cost tradeoff picked deliberately for a low-traffic app.
    // ponytail: single NAT instance is a single point of failure for
    // outbound internet from private subnets; upgrade to a managed NAT
    // Gateway (or a second NAT instance) if that path needs real uptime.
    // t3.nano isn't free-tier eligible on this account; t3.micro is.
    const natGatewayProvider = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // --- ECR ----------------------------------------------------------
    // Imported, not created: these repos already exist and hold real pushed
    // images from earlier deploy attempts (RETAIN survives a rolled-back
    // stack) — `new ecr.Repository` would collide with them on every deploy.
    // Intentionally NOT org-namespaced: these are imports (references, not
    // declared resources), so two stacks importing the same repo name never
    // collide — and every org's ECS services running the same app image is
    // the point (one codebase, N infra copies), not a per-org concern.
    const webRepo = ecr.Repository.fromRepositoryName(this, "WebRepo", "foundry-web");
    const agentRepo = ecr.Repository.fromRepositoryName(this, "AgentRuntimeRepo", "foundry-agent-runtime");

    // --- Database (RDS Postgres, single-AZ, t3.micro) -----------------
    const dbCredentials = rds.Credentials.fromGeneratedSecret("foundry_app", {
      secretName: isDefault ? "foundry/db-credentials" : `foundry/${orgName}/db-credentials`,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc,
      description: "Foundry RDS Postgres",
      allowAllOutbound: false,
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      credentials: dbCredentials,
      // Unset (CDK/CFN auto-generated) for the default stack, unchanged from
      // before this change. Explicit + org-suffixed for a second stack so
      // it's identifiable in the RDS console and can't collide.
      instanceIdentifier: isDefault ? undefined : `foundry-${orgName}-db`,
      databaseName: "foundry",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      // off during initial bring-up (repeatedly blocked stack cleanup on
      // failed deploys) — turn back on once the deployment is stable.
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      // free-tier accounts cap backup retention below RDS's own default of 7 days
      backupRetention: cdk.Duration.days(1),
    });

    // --- App secrets (values filled in manually post-deploy) ----------
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: isDefault ? "foundry/app-secrets" : `foundry/${orgName}/app-secrets`,
      description: "Clerk, Anthropic, Resend, Stripe credentials — populate manually after deploy.",
      // Do NOT add new keys to this object once the stack has been deployed
      // once and its real values populated manually. CloudFormation tracks
      // its own "last SecretString I set" record, completely disconnected
      // from whatever's actually in Secrets Manager now — changing this
      // object's shape (even just adding a key) makes CloudFormation see
      // the property as changed and push this literal placeholder JSON
      // back into Secrets Manager on the next deploy, silently wiping out
      // every real value populated since. Confirmed live (2026-08-11): the
      // deployed template's SecretString was still 100% "REPLACE_ME" even
      // after real values had been set via `put-secret-value` out of band.
      // New secrets belong in their OWN `secretsmanager.Secret` construct
      // (see RuntimeCoreSecret below) — safe to seed with a placeholder
      // only because it's a brand-new resource with no real value to lose.
      secretObjectValue: {
        CLERK_SECRET_KEY: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        CLERK_JWKS_URL: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        ANTHROPIC_API_KEY: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        RESEND_API_KEY: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        STRIPE_SECRET_KEY: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        STRIPE_PRO_PRICE_ID: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
        // registering the webhook endpoint against the live ALB URL (only
        // possible after this stack exists) comes before this has a real
        // value — placeholder until that's done.
        STRIPE_WEBHOOK_SECRET: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
      },
    });

    // Own secret, not a key inside AppSecrets — see the comment on
    // AppSecrets above for why. Shared bearer token between apps/web and
    // runtime-core/server.ts (the non-eve, PTY-backed live terminal); see
    // DEPLOY.md. Populate manually after deploy, same pattern as
    // AppSecrets — generate with `openssl rand -hex 32`.
    const runtimeCoreSecret = new secretsmanager.Secret(this, "RuntimeCoreSecret", {
      secretName: isDefault ? "foundry/runtime-core-secret" : `foundry/${orgName}/runtime-core-secret`,
      description: "Shared bearer token for the live terminal's runtime-core server — populate manually after deploy.",
      secretObjectValue: {
        RUNTIME_CORE_INTERNAL_TOKEN: cdk.SecretValue.unsafePlainText("REPLACE_ME"),
      },
    });

    // --- S3 bucket for project file storage (replaces Vercel Blob) ------
    const projectFilesBucket = new s3.Bucket(this, "ProjectFilesBucket", {
      // S3 bucket names are globally unique across ALL AWS accounts, not
      // just this one — the account id alone (already unique per-account)
      // isn't enough once a second org's stack can deploy into the SAME
      // account, so the org segment is required here even more than
      // elsewhere.
      bucketName: isDefault
        ? `foundry-project-files-${this.account}`
        : `foundry-project-files-${orgName}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- EFS for agent-runtime workflow state persistence -------------
    const workflowFileSystem = new efs.FileSystem(this, "WorkflowStateFs", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const workflowAccessPoint = workflowFileSystem.addAccessPoint("WorkflowAccessPoint", {
      path: "/eve-workflow-data",
      createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "750" },
      posixUser: { uid: "1000", gid: "1000" },
    });

    // --- ECS cluster ----------------------------------------------------
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
      clusterName: isDefault ? undefined : `foundry-${orgName}-cluster`,
    });

    // Fargate capacity is built into the cluster by default; add an EC2
    // capacity provider only for the agent-runtime service, which needs
    // the host's Docker socket for eve's docker() sandbox backend —
    // Fargate can't do that (no privileged / sibling containers).
    // minCapacity 2, not 1: an EC2-backed service with minHealthyPercent
    // 100 needs room to place a fresh task alongside the old one during a
    // rolling deploy — at capacity 1 the second instance had to launch
    // mid-rollout and didn't come up before the circuit breaker gave up
    // (observed live, 2026-08-06).
    const agentAsg = cluster.addCapacity("AgentRuntimeCapacity", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      minCapacity: 2,
      maxCapacity: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    workflowFileSystem.connections.allowDefaultPortFrom(agentAsg);

    const logGroup = new logs.LogGroup(this, "ServiceLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Shared ALB (created here so its DNS name can seed
    // NEXT_PUBLIC_APP_URL below; targets attached after the services exist)
    // ponytail: one ALB for both services instead of two (~$16-20/mo saved)
    // — fine at this scale; split them if the two services need very
    // different scaling/health-check profiles later.
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // Default 60s idle timeout kills long-running agent delegation
      // streams mid-task ("network error" observed live, 2026-08-06) —
      // multi-agent chains routinely run past a minute.
      idleTimeout: cdk.Duration.seconds(300),
      loadBalancerName: isDefault ? undefined : `foundry-${orgName}`,
    });
    const listener = alb.addListener("HttpListener", { port: 80, open: true });
    // Internal, plain-HTTP ALB URL — server-to-server calls between the two
    // containers stay on this directly (not routed through CloudFront
    // below), so they keep the ALB's own 300s idle timeout instead of
    // CloudFront's much lower origin-read ceiling. Never given to a browser.
    const appUrl = `http://${alb.loadBalancerDnsName}`;

    // --- CloudFront: HTTPS in front of the ALB, no domain required --------
    // Clerk's dev-instance handshake sets its cookies `SameSite=None`, which
    // every modern browser silently drops unless the page is also served
    // over HTTPS — confirmed live as the actual cause of E2E's sign-in never
    // completing (an infinite `dev-browser-missing` redirect loop, each one
    // minting a fresh, never-persisted cookie). The ALB has no ACM
    // certificate (would need a domain we don't have to prove ownership
    // for), so this puts a CloudFront distribution in front of it instead —
    // CloudFront's own `*.cloudfront.net` domain gets a valid public
    // certificate automatically, no domain purchase or DNS validation
    // needed. The ALB origin itself stays plain HTTP; only the
    // browser-to-CloudFront leg is HTTPS, which is the only leg Clerk's
    // handshake actually cares about.
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: new origins.HttpOrigin(alb.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          // 60s is the maximum origin response timeout CloudFront allows
          // without an AWS support quota increase — real ceiling, lower
          // than the ALB's own 300s. A single multi-minute silent gap in an
          // agent delegation stream would still get cut off here even
          // though the ALB alone would have tolerated it; not fixable
          // without requesting a limit increase from AWS.
          readTimeout: cdk.Duration.seconds(60),
          keepaliveTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // This app is 100% dynamic (SSR pages, API routes, the live
        // terminal's WebSocket) — nothing here is cacheable, and caching it
        // anyway would serve one org's page to another. ALL_VIEWER forwards
        // every header/cookie/query string the origin needs (Clerk's
        // handshake params, the terminal's Upgrade/Connection headers for
        // WebSocket passthrough) rather than CloudFront's default allowlist,
        // which strips exactly the headers this app depends on.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      comment: isDefault ? "foundry" : `foundry-${orgName}`,
    });
    // What browsers actually load, OAuth callbacks redirect to, and the
    // runtime-core WS route's Origin allowlist checks against — distinct
    // from `appUrl` above, which stays internal-only.
    const publicUrl = `https://${distribution.distributionDomainName}`;

    // --- apps/web on Fargate -------------------------------------------
    const webTaskDef = new ecs.FargateTaskDefinition(this, "WebTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    database.secret!.grantRead(webTaskDef.taskRole);
    appSecrets.grantRead(webTaskDef.taskRole);
    runtimeCoreSecret.grantRead(webTaskDef.taskRole);

    const webContainer = webTaskDef.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "web", logGroup }),
      // NEXT_PUBLIC_APP_URL is what browsers see (the CloudFront HTTPS
      // domain) — baked into the client bundle, used for OAuth callback
      // URLs. AGENT_RUNTIME_URL is server-to-server only (this container to
      // agent-runtime's, both inside the VPC) and deliberately stays on the
      // internal ALB URL: routing it through CloudFront too would cap
      // long-running eve delegation streams at CloudFront's 60s origin
      // timeout instead of the ALB's own 300s.
      environment: { PORT: "3000", NEXT_PUBLIC_APP_URL: publicUrl, AGENT_RUNTIME_URL: appUrl },
      secrets: {
        ...dbConnectionSecrets(database),
        CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(appSecrets, "CLERK_SECRET_KEY"),
        CLERK_JWKS_URL: ecs.Secret.fromSecretsManager(appSecrets, "CLERK_JWKS_URL"),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, "ANTHROPIC_API_KEY"),
        RESEND_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, "RESEND_API_KEY"),
        STRIPE_SECRET_KEY: ecs.Secret.fromSecretsManager(appSecrets, "STRIPE_SECRET_KEY"),
        STRIPE_PRO_PRICE_ID: ecs.Secret.fromSecretsManager(appSecrets, "STRIPE_PRO_PRICE_ID"),
        STRIPE_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(appSecrets, "STRIPE_WEBHOOK_SECRET"),
        GITHUB_OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecrets, "GITHUB_OAUTH_CLIENT_ID"),
        GITHUB_OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, "GITHUB_OAUTH_CLIENT_SECRET"),
        GITHUB_TOKEN_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecrets, "GITHUB_TOKEN_ENCRYPTION_KEY"),
        GOOGLE_OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecrets, "GOOGLE_OAUTH_CLIENT_ID"),
        GOOGLE_OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, "GOOGLE_OAUTH_CLIENT_SECRET"),
        // Non-secret (just the @handle shown on /dashboard/connections),
        // still sourced from appSecrets so there's one place to update it —
        // the actual bot token lives only in agent-runtime's secrets below.
        TELEGRAM_BOT_USERNAME: ecs.Secret.fromSecretsManager(appSecrets, "TELEGRAM_BOT_USERNAME"),
        // Server-side only — used to mint short-lived, session-scoped
        // terminal tokens (POST /runtime-core/v1/terminal-token) after
        // apps/web's own Clerk auth + run_sessions ownership check. Never
        // sent to the browser directly; see runtime-core/server.ts.
        RUNTIME_CORE_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(runtimeCoreSecret, "RUNTIME_CORE_INTERNAL_TOKEN"),
      },
    });
    webContainer.addPortMappings({ containerPort: 3000 });

    const webService = new ecs.FargateService(this, "WebService", {
      cluster,
      taskDefinition: webTaskDef,
      desiredCount: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });
    database.connections.allowDefaultPortFrom(webService);

    // --- apps/agent-runtime on EC2-backed ECS --------------------------
    const agentTaskDef = new ecs.Ec2TaskDefinition(this, "AgentRuntimeTaskDef", {
      networkMode: ecs.NetworkMode.BRIDGE,
      volumes: [
        {
          name: "docker-socket",
          host: { sourcePath: "/var/run/docker.sock" },
        },
        {
          name: "workflow-state",
          efsVolumeConfiguration: {
            fileSystemId: workflowFileSystem.fileSystemId,
            transitEncryption: "ENABLED",
            authorizationConfig: { accessPointId: workflowAccessPoint.accessPointId, iam: "ENABLED" },
          },
        },
      ],
    });
    database.secret!.grantRead(agentTaskDef.taskRole);
    appSecrets.grantRead(agentTaskDef.taskRole);
    runtimeCoreSecret.grantRead(agentTaskDef.taskRole);
    workflowFileSystem.grantReadWrite(agentTaskDef.taskRole);
    projectFilesBucket.grantReadWrite(agentTaskDef.taskRole);

    const agentContainer = agentTaskDef.addContainer("agent-runtime", {
      image: ecs.ContainerImage.fromEcrRepository(agentRepo, "latest"),
      memoryLimitMiB: 1536,
      cpu: 512,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "agent-runtime", logGroup }),
      environment: {
        PORT: "3000",
        // Public URL — used to build links in notification emails, so they
        // need to actually resolve for whoever clicks them.
        APP_URL: publicUrl,
        PROJECT_FILES_BUCKET: projectFilesBucket.bucketName,
        // runtime-core/server.ts's WS terminal route origin allowlist — a
        // browser's Origin header on the terminal's WS upgrade will be the
        // CloudFront domain now, not the raw ALB URL.
        APP_ORIGINS: publicUrl,
      },
      secrets: {
        ...dbConnectionSecrets(database),
        CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(appSecrets, "CLERK_SECRET_KEY"),
        CLERK_JWKS_URL: ecs.Secret.fromSecretsManager(appSecrets, "CLERK_JWKS_URL"),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, "ANTHROPIC_API_KEY"),
        RESEND_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, "RESEND_API_KEY"),
        // Only the encryption key, not the OAuth client id/secret — the
        // token exchange happens in apps/web's callback route; agent-runtime
        // only ever decrypts an already-stored token (see
        // agent/lib/github-connection-auth.ts).
        GITHUB_TOKEN_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecrets, "GITHUB_TOKEN_ENCRYPTION_KEY"),
        // Unlike GitHub, agent-runtime DOES need the OAuth client id/secret
        // here — Google access tokens expire in ~1hr, so
        // google-calendar-connection-auth.ts refreshes them itself (rather
        // than only ever reading a token apps/web already refreshed), which
        // needs the client credentials to call Google's token endpoint.
        GOOGLE_OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecrets, "GOOGLE_OAUTH_CLIENT_ID"),
        GOOGLE_OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, "GOOGLE_OAUTH_CLIENT_SECRET"),
        // Platform-level, not per-org — same model as RESEND_API_KEY.
        // place_call.ts/get_call_result.ts (lib/twilio-call.ts) are the
        // only readers.
        TWILIO_ACCOUNT_SID: ecs.Secret.fromSecretsManager(appSecrets, "TWILIO_ACCOUNT_SID"),
        TWILIO_AUTH_TOKEN: ecs.Secret.fromSecretsManager(appSecrets, "TWILIO_AUTH_TOKEN"),
        TWILIO_FROM_NUMBER: ecs.Secret.fromSecretsManager(appSecrets, "TWILIO_FROM_NUMBER"),
        // Platform-level, one bot for every org (agent/channels/telegram.ts,
        // agent/lib/telegram-link.ts) — see DEPLOY.md for the one-time
        // `setWebhook` registration step this doesn't do automatically.
        TELEGRAM_BOT_TOKEN: ecs.Secret.fromSecretsManager(appSecrets, "TELEGRAM_BOT_TOKEN"),
        TELEGRAM_WEBHOOK_SECRET_TOKEN: ecs.Secret.fromSecretsManager(appSecrets, "TELEGRAM_WEBHOOK_SECRET_TOKEN"),
        TELEGRAM_BOT_USERNAME: ecs.Secret.fromSecretsManager(appSecrets, "TELEGRAM_BOT_USERNAME"),
        // runtime-core/server.ts's own auth — see start.mjs, which runs it
        // alongside eve as a second process in this same container/task.
        RUNTIME_CORE_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(runtimeCoreSecret, "RUNTIME_CORE_INTERNAL_TOKEN"),
      },
    });
    agentContainer.addPortMappings({ containerPort: 3000 }, { containerPort: 3313 });
    agentContainer.addMountPoints(
      { containerPath: "/var/run/docker.sock", sourceVolume: "docker-socket", readOnly: false },
      { containerPath: "/repo/apps/agent-runtime/.eve/.workflow-data", sourceVolume: "workflow-state", readOnly: false },
    );
    const agentService = new ecs.Ec2Service(this, "AgentRuntimeService", {
      cluster,
      taskDefinition: agentTaskDef,
      desiredCount: 1,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });
    database.connections.allowDefaultPortFrom(agentService);

    // --- Attach ALB targets now that both services exist ----------------
    const webTargetGroup = listener.addTargets("WebTargets", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [webService],
      healthCheck: { path: "/", healthyHttpCodes: "200-399" },
    });

    // /eve/* and /.well-known/workflow/* must reach agent-runtime WITHOUT
    // path rewriting — a proxy that only forwards /eve/ lets a session
    // start but stalls its workflow callback.
    listener.addTargets("AgentRuntimeTargets", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // Explicit containerPort, not just `[agentService]` — the container
      // now has two port mappings (3000 for eve, 3313 for runtime-core),
      // so which one this target group means needs to be unambiguous.
      targets: [agentService.loadBalancerTarget({ containerName: "agent-runtime", containerPort: 3000 })],
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/eve/*", "/.well-known/workflow/*"])],
      healthCheck: { path: "/eve/v1/health", healthyHttpCodes: "200-399" },
    });

    // runtime-core/server.ts's own port (3313) — separate target group
    // since it's a different containerPort than eve's 3000, same
    // agentService/task either way. The ALB proxies WebSocket upgrades
    // transparently over this same HTTP listener, no separate listener
    // needed (confirmed supported for ALB, unlike classic ELB).
    listener.addTargets("RuntimeCoreTargets", {
      port: 3313,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [agentService.loadBalancerTarget({ containerName: "agent-runtime", containerPort: 3313 })],
      priority: 11,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/runtime-core/*"])],
      healthCheck: { path: "/runtime-core/v1/health", healthyHttpCodes: "200-399" },
    });
    void webTargetGroup;

    // --- GitHub Actions CI/CD: OIDC + deploy roles -----------------------
    // Only created for the default/primary stack. Two reasons this whole
    // block is skipped for a second org's stack rather than org-namespaced
    // like everything else above:
    //   1. An IAM OIDC provider for a given URL is an account-level
    //      singleton in AWS — a second `new iam.OpenIdConnectProvider` for
    //      the same "token.actions.githubusercontent.com" URL in this same
    //      account fails outright, namespacing or not.
    //   2. There is exactly one GitHub repo/CI pipeline; per-customer
    //      deploys here are manual `cdk deploy` runs (see DEPLOY.md), not a
    //      separate automated pipeline per org, so a per-org deploy role
    //      has nothing to do.
    // No long-lived AWS keys stored in GitHub — a workflow run presents a
    // short-lived OIDC token and assumes one of these roles instead. Two
    // roles, not one: `deployRole` (used on every push) only has the exact
    // permissions the manual build/push/migrate/redeploy sequence this
    // session used by hand needs; `cdkDeployRole` (used only when infra/**
    // changes) is broader and kept separate so the everyday app-deploy path
    // stays minimally privileged.
    let deployRoleArn: string | undefined;
    let cdkDeployRoleArn: string | undefined;
    if (isDefault) {
    const githubOidcProvider = new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    // GitHub's actual `sub` claim is NOT the plain `repo:owner/repo:ref:...`
    // most docs/examples show — it's `repo:owner@USER_ID/repo@REPO_ID:ref:...`
    // (GitHub appends stable numeric IDs specifically so a trust condition
    // can't be bypassed by an attacker registering a same-prefixed account
    // or repo, e.g. "saransh21122112999" or "foundry-evil"). Confirmed live
    // via CloudTrail after an exact-string version was deployed and every
    // assume-role attempt got denied: the real userName was
    // "repo:saransh21122112@74602862/foundry@1319641243:ref:refs/heads/main".
    // Pinned via StringEquals on the exact IDs — the whole point of them
    // being stable is that this is safe (not fragile) to hardcode, and an
    // earlier version of this condition used an unanchored StringLike
    // wildcard ("saransh21122112*/foundry*") that defeated that entire
    // protection by matching any account/repo name with these as a prefix.
    const githubOidcPrincipal = new iam.OpenIdConnectPrincipal(githubOidcProvider, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:saransh21122112@74602862/foundry@1319641243:ref:refs/heads/main",
      },
    });

    const dbMigrateRepo = ecr.Repository.fromRepositoryName(this, "DbMigrateRepo", "foundry-db-migrate");

    const deployRole = new iam.Role(this, "GithubDeployRole", {
      roleName: "foundry-deploy",
      assumedBy: githubOidcPrincipal,
      description: "Assumed by GitHub Actions (push to main) to build/push images, run migrations, and redeploy ECS services.",
    });
    // ECR: GetAuthorizationToken has no resource-level permissions — AWS
    // requires it be granted on "*" regardless of which repos are pushed to.
    deployRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
        ],
        resources: [webRepo.repositoryArn, agentRepo.repositoryArn, dbMigrateRepo.repositoryArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateService", "ecs:DescribeServices"],
        resources: [webService.serviceArn, agentService.serviceArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        // Not CDK-managed (see packages/db/Dockerfile.migrate's own comment) —
        // referenced by ARN pattern, same account/region as everything else.
        resources: [`arn:aws:ecs:${this.region}:${this.account}:task-definition/foundry-db-migrate:*`],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeTasks", "ecs:DescribeTaskDefinition"],
        resources: ["*"],
      }),
    );
    // ECS must be able to pass these roles to the tasks it starts/updates —
    // the migrate task reuses WebTaskDef's own roles (see that task
    // definition's executionRoleArn/taskRoleArn, registered out-of-band).
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          webTaskDef.taskRole.roleArn,
          webTaskDef.executionRole!.roleArn,
          agentTaskDef.taskRole.roleArn,
          agentTaskDef.executionRole!.roleArn,
        ],
      }),
    );

    const cdkDeployRole = new iam.Role(this, "GithubCdkDeployRole", {
      roleName: "foundry-cdk-deploy",
      assumedBy: githubOidcPrincipal,
      description: "Assumed by GitHub Actions (when infra/** changes) to run cdk deploy, via CDK's own bootstrap roles.",
    });
    // CDK's bootstrap roles (deploy/file-publishing/image-publishing/lookup)
    // already hold the real CloudFormation/S3/ECR permissions needed to
    // deploy this stack — the deploying identity only needs to assume them,
    // not reimplement their policies here.
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-role-${this.account}-${this.region}`],
      }),
    );

    deployRoleArn = deployRole.roleArn;
    cdkDeployRoleArn = cdkDeployRole.roleArn;
    } // isDefault

    // --- Outputs --------------------------------------------------------
    new cdk.CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "PublicUrl", { value: publicUrl });
    new cdk.CfnOutput(this, "WebRepoUri", { value: webRepo.repositoryUri });
    new cdk.CfnOutput(this, "AgentRuntimeRepoUri", { value: agentRepo.repositoryUri });
    new cdk.CfnOutput(this, "DbSecretArn", { value: database.secret!.secretArn });
    new cdk.CfnOutput(this, "AppSecretsArn", { value: appSecrets.secretArn });
    new cdk.CfnOutput(this, "RuntimeCoreSecretArn", { value: runtimeCoreSecret.secretArn });
    if (deployRoleArn) new cdk.CfnOutput(this, "GithubDeployRoleArn", { value: deployRoleArn });
    if (cdkDeployRoleArn) new cdk.CfnOutput(this, "GithubCdkDeployRoleArn", { value: cdkDeployRoleArn });
  }
}
