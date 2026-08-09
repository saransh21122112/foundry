import { defineTool } from "eve/tools";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { s3, projectFilesBucket } from "../../../../../lib/s3-client";

/**
 * Same pattern as eng-lead/tools/save_project_file.ts (S3 key scheme,
 * no-clobber, approval gating) — swe-lead's nested subagents had no tool
 * of their own before this, so nothing they "delivered" ever persisted.
 * `department: "swe-lead"` (not "eng-lead") so budget/allowlist/rate-limit
 * gating applies to swe-lead's own department, not eng-lead's.
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
      department: "swe-lead",
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
