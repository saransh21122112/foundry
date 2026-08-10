import { defineTool } from "eve/tools";
import { z } from "zod";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * General-purpose sandboxed command execution — the safe version of "give
 * the agent exec access". Runs entirely inside eve's per-session sandbox
 * (`ctx.getSandbox()`, same primitive `clone_repo.ts` already uses), which
 * per eve's own concepts/security-model.md trust-boundary table has: no
 * host secrets/process.env, no path back into this app's own runtime, and
 * a filesystem isolated to /workspace — nothing here can reach another
 * org's data or this container's own credentials. Deliberately NOT the
 * host-level exec/filesystem access a request earlier this session asked
 * for and was declined (see chat) — the isolation is the entire point of
 * this tool existing instead of that.
 *
 * riskClass "reversible-high", same as clone_repo.ts/save_project_file.ts
 * — checked directly against enforce.ts before picking this: it's NOT one
 * of HARD_RULE_RISK_CLASSES, so at autonomy_level "bounded_autonomous" a
 * call can pass without a human pause (same as those two sibling tools
 * already do). That's an intentional, existing precedent, not a gap
 * specific to this tool — the sandbox's own isolation is what bounds the
 * blast radius here, not approval-gating alone.
 */
export default defineTool({
  description:
    "Run a shell command inside an isolated, per-session sandbox (not the host machine, not another org's data) and return its exit code, stdout, and stderr. Use for real work that needs actual code execution — running a script, a build, a test suite — not for anything that needs to reach outside the sandbox.",
  inputSchema: z.object({
    command: z.string().min(1).max(4000),
    workingDirectory: z.string().optional(),
  }),
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "sandbox_runs", amount: 1 },
    },
    dbDeps,
  ),
  async execute({ command, workingDirectory }, ctx) {
    const sandbox = await ctx.getSandbox();
    const result = await sandbox.run({ command, workingDirectory });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  },
});
