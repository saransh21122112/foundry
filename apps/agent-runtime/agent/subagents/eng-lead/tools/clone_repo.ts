import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { resolveGithubToken } from "../../../lib/github-connection-auth";

const execFileAsync = promisify(execFile);

/**
 * Clones a repo from this org's connected GitHub account directly onto
 * this deployment's own host — no sandbox (see exec_host.ts's comment on
 * why: this is a standalone, self-hosted, deploy-your-own-instance app
 * now, matching OpenClaw's own host-first model).
 *
 * `execFile` with an argv array, never a shell string — same reasoning
 * exec_host.ts documents, and the exact fix a security review already
 * applied to this file's previous (sandboxed, shell-string) version
 * earlier this session: a shell turns untrusted argv values into a
 * command-injection primitive. The token is embedded directly in the
 * clone URL argv element (no shell to leak it into logs via injection),
 * then scrubbed via `git remote set-url` immediately after — still
 * technically visible to `ps` on this host for the brief clone duration,
 * an accepted, minor exposure in a single-tenant trusted-operator
 * deployment (same model OpenClaw's own docs describe), not something
 * worth a bigger credential-helper mechanism for.
 *
 * Still gated by the exact same approval policy as every other real side
 * effect — an org on draft_only sees this queued, same as before.
 */
export default defineTool({
  description:
    "Clone a repository from this organization's connected GitHub account onto this deployment's own host. " +
    "Use the clone_url from repos/list-for-authenticated-user, list_my_github_repos, or a PR/issue's repository field.",
  inputSchema: z.object({
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
    const authedUrl = input.cloneUrl.replace("https://", `https://x-access-token:${token}@`);

    try {
      await execFileAsync("git", ["clone", authedUrl, input.targetDir], { timeout: 120_000 });
      await execFileAsync("git", ["-C", input.targetDir, "remote", "set-url", "origin", input.cloneUrl]);
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new Error(`git clone failed: ${(e.stderr ?? e.message).slice(0, 500)}`);
    }

    return { cloned: true, path: input.targetDir };
  },
});
