import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { assertNotSharedInstance } from "../../../lib/shared-instance-guard";

const execFileAsync = promisify(execFile);

/**
 * Direct host execution — runs in the agent-runtime container itself.
 * No sandbox: this app is a standalone, self-hosted, deploy-your-own-
 * instance product (see ARCHITECTURE.md's "Deployment model" section,
 * README.md), the same OpenClaw distribution model this was explicitly
 * rebuilt around — host-first execution is the normal case there, not a
 * special mode. Sandboxed execution (eve's `ctx.getSandbox()`) has been
 * removed from this app's tools entirely, matching that.
 *
 * `execFile` (argv array), never a shell string — same reasoning
 * OpenClaw's own exec-spawn.ts hard-codes `shell: false` for: a shell
 * turns untrusted argv values into a command-injection primitive, and
 * this codebase already had that exact class of bug caught by security
 * review in clone_repo.ts earlier this session. No `command` string to
 * interpolate here at all — `command` is a bare executable name/path,
 * `args` is a plain string array passed straight to execFile, never
 * concatenated into anything a shell parses.
 *
 * Still gated through `enforce()` exactly like every other real
 * side-effecting tool (`riskClass: "reversible-high"`) — removing the
 * sandbox is not the same as removing guardrails. OpenClaw's own real
 * agent-loop.ts does the identical thing: host-first execution, still
 * gated through a `beforeToolCall`/exec-approval hook (confirmed by
 * reading its actual source this session, not assumed).
 *
 * `FOUNDRY_SHARED_INSTANCE` is the one remaining safety net, added after
 * automated security review correctly flagged that removing the old
 * ALLOW_HOST_EXEC opt-in left the real shared-tenant case (running the
 * **default** stack itself with more than one org in its own database —
 * see ARCHITECTURE.md's "Deployment model" section; NOT DEPLOY.md §6's
 * "extending an existing shared instance," which is a fully isolated
 * second stack and not actually a risk) with no code-level protection —
 * a successful call there would have host-level reach across org
 * boundaries with only the approval gate stopping it. This flips the
 * polarity of the old gate: normal single-org deployments (the default,
 * what this app is built around now) need no flag and get zero friction;
 * only a deployment explicitly marked as shared opts into the
 * restriction. Not restored: the old default-off gate, since that
 * reintroduced exactly the friction removed at explicit, repeated
 * request — this only bites the one configuration actually documented
 * as risky. Implementation shared with clone_repo.ts in
 * lib/shared-instance-guard.ts.
 */
export default defineTool({
  description:
    "Run a command directly on this deployment's own host — real filesystem and network access. Use for real work that needs actual code execution.",
  inputSchema: z.object({
    command: z.string().min(1).max(200),
    args: z.array(z.string().max(2000)).max(50).default([]),
    cwd: z.string().optional(),
  }),
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "host_execs", amount: 1 },
    },
    dbDeps,
  ),
  async execute({ command, args, cwd }) {
    assertNotSharedInstance("exec_host");
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
      if (typeof e.code === "number") {
        return { exitCode: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
      }
      throw new Error(`exec_host failed: ${e.message}`);
    }
  },
});
