import { defineTool } from "eve/tools";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Writes a real deliverable to this org's own folder on the host disk, at
 * ~/Projects/foundry_projects/<projectSlug>/<relativePath> — the Foundry
 * equivalent of the personal ai-company plugin's "new work gets its own
 * folder under ~/Projects/<slug>/" convention. Distinct from eve's default
 * sandbox (ephemeral, container-local, gone once the session ends): this
 * lands on real disk so a finished draft survives past the session.
 *
 * riskClass "reversible-low" (same reasoning as get_activity_summary.ts):
 * creating a new file is as reversible as any other draft, so no `approval`
 * field, just the kill-switch check every reversible-low tool still owes.
 * Refuses to overwrite an existing file rather than gating on approval —
 * that keeps a runaway agent from clobbering earlier output while still
 * needing no human in the loop for the common case of writing something new.
 *
 * Real tool_call_executed/tool_call_failed outcomes are logged generically
 * by the action.result eve hook (see
 * apps/agent-runtime/agent/lib/log-tool-result.ts) — this tool no longer
 * hand-writes them.
 */
const PROJECTS_ROOT = path.join(process.env.HOME ?? "", "Projects", "foundry_projects");

export default defineTool({
  description:
    "Save a file (code, script, doc) as a real deliverable for this organization, on disk under its own project folder. Use this for anything meant to outlive the conversation — not for scratch work.",
  inputSchema: z.object({
    projectSlug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
    relativePath: z.string().min(1),
    contents: z.string(),
  }),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "eng-lead" }, dbDeps);

    const projectDir = path.join(PROJECTS_ROOT, input.projectSlug);
    const targetPath = path.join(projectDir, input.relativePath);
    if (targetPath !== projectDir && !targetPath.startsWith(projectDir + path.sep)) {
      throw new Error("relativePath escapes the project folder.");
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await writeFile(targetPath, input.contents, { flag: "wx" });
    } catch (err) {
      const failMessage =
        (err as NodeJS.ErrnoException).code === "EEXIST"
          ? `${input.relativePath} already exists in ${input.projectSlug} — use a different name, or ask the user before overwriting.`
          : (err as Error).message;
      throw new Error(failMessage);
    }

    return { saved: true, path: targetPath };
  },
});
