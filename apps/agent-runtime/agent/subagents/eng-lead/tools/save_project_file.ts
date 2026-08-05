import { defineTool } from "eve/tools";
import { z } from "zod";
import { put } from "@vercel/blob";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Writes a real deliverable to this org's own namespace in Vercel Blob
 * (private access), at `<orgId>/<projectSlug>/<relativePath>`. Distinct
 * from eve's default sandbox (ephemeral, container-local, gone once the
 * session ends): this survives past the session — and, unlike a plain
 * `node:fs` write, past the request too. A Serverless Function has no
 * persistent disk — each invocation runs in its own fresh container, so
 * anything written to the local filesystem vanishes the moment that
 * invocation ends. This tool used to write to `~/Projects/foundry_projects/`
 * on the host disk (fine under local `eve dev`, silently no-op-equivalent
 * once actually deployed — found live, 2026-08-05: nothing an org saved in
 * production ever actually persisted anywhere). Blob is the fix: durable,
 * and reachable from any invocation regardless of which container ran it.
 *
 * The `<orgId>/` prefix (not present in the old disk-path scheme) is a
 * real fix, not just a translation — `projectSlug` alone was never
 * guaranteed unique across orgs, so two tenants using the same slug would
 * have collided in a shared disk path. Blob pathnames are still per-tenant
 * scoped the same way every other table in this codebase is (see e.g.
 * activityLog.orgId) — no reason a shared file store should be the one
 * place that isn't.
 *
 * riskClass "reversible-low" (same reasoning as get_activity_summary.ts):
 * creating a new file is as reversible as any other draft, so no `approval`
 * field, just the kill-switch check every reversible-low tool still owes.
 * `allowOverwrite: false` (Blob's own default) refuses to clobber an
 * existing file rather than gating on approval — keeps a runaway agent
 * from overwriting earlier output while still needing no human in the loop
 * for the common case of writing something new.
 *
 * Real tool_call_executed/tool_call_failed outcomes are logged generically
 * by the action.result eve hook (see
 * apps/agent-runtime/agent/lib/log-tool-result.ts) — this tool no longer
 * hand-writes them.
 */
export default defineTool({
  description:
    "Save a file (code, script, doc) as a real deliverable for this organization, in its own private project namespace. Use this for anything meant to outlive the conversation — not for scratch work.",
  inputSchema: z.object({
    projectSlug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
    relativePath: z.string().min(1).refine((p) => !p.includes(".."), "relativePath may not contain '..'"),
    contents: z.string(),
  }),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "eng-lead" }, dbDeps);

    const pathname = `${orgId}/${input.projectSlug}/${input.relativePath}`;

    try {
      const blob = await put(pathname, input.contents, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return { saved: true, path: blob.pathname, url: blob.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failMessage = message.toLowerCase().includes("exist")
        ? `${input.relativePath} already exists in ${input.projectSlug} — use a different name, or ask the user before overwriting.`
        : message;
      throw new Error(failMessage);
    }
  },
});
