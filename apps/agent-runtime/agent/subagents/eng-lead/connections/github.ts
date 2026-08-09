import { defineOpenAPIConnection } from "eve/connections";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { resolveGithubToken } from "../../../lib/github-connection-auth";

/**
 * Declared subagents inherit nothing from the root by default — a
 * connection only reaches a subagent that has its own `connections/`
 * directory (node_modules/eve/docs/subagents.mdx:66,72). eng-lead only for
 * this pass: swe-lead's nested children (frontend-developer etc.) would
 * need the identical 2-levels-deep approval-resume path that's currently
 * unreliable (see the approval-resume investigation) — extend there once
 * that's fixed, not before.
 *
 * Phase 1 scope (read + comment, no code-writing): opening a real PR needs
 * commits to land in a branch first, which is a separate design problem
 * (either handing the sandbox's bash/git a live credential, or building
 * commits via GitHub's Git Data API through this same connection) — not
 * attempted here.
 */
export default defineOpenAPIConnection({
  spec: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
  baseUrl: "https://api.github.com",
  description: "Read issues and pull requests, and post comments, in this organization's connected GitHub account.",
  operations: {
    allow: [
      "issues/list-for-repo",
      "issues/get",
      "issues/create",
      "issues/create-comment",
      "pulls/list",
      "pulls/get",
    ],
  },
  auth: (ctx) => ({
    getToken: async () => {
      const orgId = ctx.session.auth.current?.attributes?.orgId;
      if (typeof orgId !== "string") {
        throw new Error("No organization resolved on this session.");
      }
      return { token: await resolveGithubToken(orgId) };
    },
  }),
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "github_calls", amount: 1 },
    },
    dbDeps,
  ),
});
