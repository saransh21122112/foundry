import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

const execFileAsync = promisify(execFile);

/**
 * Direct host execution — runs in the agent-runtime container itself, not
 * eve's isolated sandbox (`ctx.getSandbox()`, what run_code.ts uses).
 * This is the real "give it exec access" capability, closing the one
 * actual gap between eve's sandboxed model and OpenClaw's host-first one
 * (see the plan this was built from — OpenClaw's own agent-loop.ts still
 * gates every tool call through a `beforeToolCall` hook, and its exec
 * tool specifically through a real approval subsystem; it is not "host
 * exec with no gate"). Foundry's `enforce()`/`approval` below is that
 * same kind of gate, already more general than OpenClaw's exec-specific
 * one — so this tool is gated exactly like run_code.ts/clone_repo.ts,
 * not exempted from guardrails.
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
 * NOT enabled by default on any deployment — `ALLOW_HOST_EXEC` must be
 * set to exactly "true" in this container's own environment, or this
 * throws instead of running. The current shared (multi-org) production
 * deployment does not set this var and must not until it's retired or
 * genuinely single-tenant — see infra/lib/foundry-stack.ts and DEPLOY.md.
 * This is a real runtime gate, not just a comment: eve discovers tool
 * files by directory location regardless of which deployment runs them,
 * so the file existing here does not by itself make it live anywhere.
 */
export default defineTool({
  description:
    "Run a command directly on this deployment's own host (not an isolated sandbox) — real filesystem and network access. Only available on dedicated single-org deployments with host exec explicitly enabled. Use for work that genuinely needs to reach outside an isolated sandbox; prefer run_code for anything that doesn't.",
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
    if (process.env.ALLOW_HOST_EXEC !== "true") {
      throw new Error(
        "Host execution is not enabled on this deployment. This tool only runs on dedicated single-org " +
          "deployments with ALLOW_HOST_EXEC explicitly set — see DEPLOY.md.",
      );
    }

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
