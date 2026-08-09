import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
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

export class FoundryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
    const webRepo = ecr.Repository.fromRepositoryName(this, "WebRepo", "foundry-web");
    const agentRepo = ecr.Repository.fromRepositoryName(this, "AgentRuntimeRepo", "foundry-agent-runtime");

    // --- Database (RDS Postgres, single-AZ, t3.micro) -----------------
    const dbCredentials = rds.Credentials.fromGeneratedSecret("foundry_app", {
      secretName: "foundry/db-credentials",
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
      secretName: "foundry/app-secrets",
      description: "Clerk, Anthropic, Resend, Stripe credentials — populate manually after deploy.",
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

    // --- S3 bucket for project file storage (replaces Vercel Blob) ------
    const projectFilesBucket = new s3.Bucket(this, "ProjectFilesBucket", {
      bucketName: `foundry-project-files-${this.account}`,
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
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsights: true });

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
    });
    const listener = alb.addListener("HttpListener", { port: 80, open: true });
    const appUrl = `http://${alb.loadBalancerDnsName}`;

    // --- apps/web on Fargate -------------------------------------------
    const webTaskDef = new ecs.FargateTaskDefinition(this, "WebTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    database.secret!.grantRead(webTaskDef.taskRole);
    appSecrets.grantRead(webTaskDef.taskRole);

    const webContainer = webTaskDef.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "web", logGroup }),
      // agent-runtime is reachable on this same ALB under /eve/* — same
      // appUrl the web app's own public URL uses, not a separate address.
      environment: { PORT: "3000", NEXT_PUBLIC_APP_URL: appUrl, AGENT_RUNTIME_URL: appUrl },
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
    workflowFileSystem.grantReadWrite(agentTaskDef.taskRole);
    projectFilesBucket.grantReadWrite(agentTaskDef.taskRole);

    const agentContainer = agentTaskDef.addContainer("agent-runtime", {
      image: ecs.ContainerImage.fromEcrRepository(agentRepo, "latest"),
      memoryLimitMiB: 1536,
      cpu: 512,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "agent-runtime", logGroup }),
      environment: { PORT: "3000", APP_URL: appUrl, PROJECT_FILES_BUCKET: projectFilesBucket.bucketName },
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
      },
    });
    agentContainer.addPortMappings({ containerPort: 3000 });
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
      targets: [agentService],
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/eve/*", "/.well-known/workflow/*"])],
      healthCheck: { path: "/eve/v1/health", healthyHttpCodes: "200-399" },
    });
    void webTargetGroup;

    // --- GitHub Actions CI/CD: OIDC + deploy roles -----------------------
    // No long-lived AWS keys stored in GitHub — a workflow run presents a
    // short-lived OIDC token and assumes one of these roles instead. Two
    // roles, not one: `deployRole` (used on every push) only has the exact
    // permissions the manual build/push/migrate/redeploy sequence this
    // session used by hand needs; `cdkDeployRole` (used only when infra/**
    // changes) is broader and kept separate so the everyday app-deploy path
    // stays minimally privileged.
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

    // --- Outputs --------------------------------------------------------
    new cdk.CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "WebRepoUri", { value: webRepo.repositoryUri });
    new cdk.CfnOutput(this, "AgentRuntimeRepoUri", { value: agentRepo.repositoryUri });
    new cdk.CfnOutput(this, "DbSecretArn", { value: database.secret!.secretArn });
    new cdk.CfnOutput(this, "AppSecretsArn", { value: appSecrets.secretArn });
    new cdk.CfnOutput(this, "GithubDeployRoleArn", { value: deployRole.roleArn });
    new cdk.CfnOutput(this, "GithubCdkDeployRoleArn", { value: cdkDeployRole.roleArn });
  }
}
