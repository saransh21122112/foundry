#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FoundryStack } from "../lib/foundry-stack";

const app = new cdk.App();

// Which org this deployment is for. Defaults to "default" so the existing
// shared stack's deploy command (no --context flag) is unaffected — same
// stack id, same resource physical names as before this was added. Pass
// `--context orgName=<name>` to deploy a second, independent stack for a
// specific customer (see DEPLOY.md).
const orgName = (app.node.tryGetContext("orgName") as string | undefined) ?? "default";
const stackId = orgName === "default" ? "FoundryStack" : `FoundryStack-${orgName}`;

new FoundryStack(app, stackId, {
  orgName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
