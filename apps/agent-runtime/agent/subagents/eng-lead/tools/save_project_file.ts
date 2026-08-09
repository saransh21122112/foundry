import { defineTool } from "eve/tools";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { s3, projectFilesBucket } from "../../../lib/s3-client";

/**
 * Writes a real deliverable to this org's own namespace in S3 (private,
 * SSE-encrypted bucket), at `<orgId>/<projectSlug>/<relativePath>`. Distinct
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
 * riskClass "reversible-high" (2026-08-07 reclassification — this was
 * previously "reversible-low", which let it skip enforce() entirely: no
 * autonomy-level gating, no budget cap, no allowlist. A durable write to a
 * real S3 bucket is a genuine side effect, same shape as send_email.ts /
 * post_webhook.ts, so it now goes through `approval: makeApprovalPolicy`
 * like those two. `IfNoneMatch: "*"` still refuses to clobber an existing
 * file regardless of the approval outcome — belt-and-suspenders against a
 * runaway agent overwriting earlier output.
 *
 * No standalone `assertNotKilled()` call here — enforce() (invoked via the
 * `approval` policy below) already checks the kill switch, department
 * enabled, and autonomy level before this tool's `execute()` ever runs
 * (see enforce.ts steps 1-3). Calling it again here would be dead code.
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
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "files_saved", amount: 1 },
    },
    dbDeps,
  ),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      // Shouldn't happen — the approval policy above already denies
      // no-org sessions before execute() ever runs.
      throw new Error("No organization resolved on this session.");
    }

    const key = `${orgId}/${input.projectSlug}/${input.relativePath}`;

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: projectFilesBucket(),
          Key: key,
          Body: input.contents,
          IfNoneMatch: "*",
        }),
      );
      return { saved: true, path: key };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "PreconditionFailed") {
        throw new Error(
          `${input.relativePath} already exists in ${input.projectSlug} — use a different name, or ask the user before overwriting.`,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  },
});
