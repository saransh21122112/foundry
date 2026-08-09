import { defineTool } from "eve/tools";
import { z } from "zod";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { resolveGithubToken } from "../../../lib/github-connection-auth";

/**
 * Clones a repo from this org's connected GitHub account into the sandbox
 * workspace, using the same resolved token as the github connection
 * (github-connection-auth.ts). A real trust-boundary tradeoff, deliberate
 * and scoped: the sandbox is normally the untrusted side of eve's security
 * model (no secrets — see node_modules/eve/docs/concepts/security-model.md),
 * so handing it a live token is not done lightly. Mitigations:
 *
 * - The token is passed via `sandbox.run`'s `env` option, not interpolated
 *   into the command string — eve's own AI SDK sandbox types call this out
 *   explicitly as "preferable from a security perspective, e.g. to avoid
 *   them leaking in logs" (@ai-sdk/provider-utils SandboxProcessOptions).
 *   The literal token value never appears in `command` text, so it isn't
 *   captured wherever that string gets logged (activity log, tool results).
 * - Immediately after clone, `git remote set-url` scrubs the token back out
 *   of the URL embedded in the resulting repo's own `.git/config`, so nothing
 *   persists past the clone step itself even within the sandbox.
 * - Still gated by the exact same approval policy as every other real side
 *   effect — an org on draft_only sees this queued, same as save_project_file.
 */
export default defineTool({
  description:
    "Clone a repository from this organization's connected GitHub account into the sandbox workspace. " +
    "Use the clone_url from repos/list-for-authenticated-user or a PR/issue's repository field.",
  inputSchema: z.object({
    // Fully anchored to GitHub's actual owner/repo charset — not just a
    // `.url()` + prefix check. That weaker check let query strings/fragments
    // through, and since cloneUrl is interpolated inside double quotes in
    // the shell command below, bash still expands `$(...)`/backticks/`$VAR`
    // even inside double quotes — a real command-injection vector caught by
    // security review before this shipped.
    cloneUrl: z
      .string()
      .regex(
        /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/,
        "must be an https://github.com/OWNER/REPO(.git) clone URL",
      ),
    targetDir: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.\-/]+$/, "letters, numbers, hyphens, underscores, dots, slashes only")
      .refine((p) => !p.includes(".."), "targetDir may not contain '..'"),
  }),
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "repo_clones", amount: 1 },
    },
    dbDeps,
  ),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }

    const token = await resolveGithubToken(orgId);
    const sandbox = await ctx.getSandbox();
    const authedUrl = input.cloneUrl.replace("https://", "https://x-access-token:$GH_CLONE_TOKEN@");

    const result = await sandbox.run({
      command:
        `git clone "${authedUrl}" "${input.targetDir}" && ` +
        `git -C "${input.targetDir}" remote set-url origin "${input.cloneUrl}"`,
      env: { GH_CLONE_TOKEN: token },
    });

    if (result.exitCode !== 0) {
      throw new Error(`git clone failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`);
    }

    return { cloned: true, path: input.targetDir };
  },
});
