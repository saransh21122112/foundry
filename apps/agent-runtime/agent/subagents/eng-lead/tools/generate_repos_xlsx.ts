import { defineTool } from "eve/tools";
import { z } from "zod";
import ExcelJS from "exceljs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { s3, projectFilesBucket } from "../../../lib/s3-client";

/**
 * Builds a real .xlsx (repo name + clone URL) from repo data the model
 * already has (typically from calling github__reposListForAuthenticatedUser
 * first) and saves it via the same S3 path/no-clobber pattern as
 * save_project_file.ts. Kept as its own tool rather than folded into
 * save_project_file — that tool takes a plain string body, not structured
 * rows, and xlsx is a real binary format, not something worth asking the
 * model to hand-assemble as text.
 */
export default defineTool({
  description:
    "Build an .xlsx spreadsheet listing repo name + clone URL pairs and save it as a project file. " +
    "Pass the repos array from a prior repos/list-for-authenticated-user call.",
  inputSchema: z.object({
    projectSlug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
    relativePath: z
      .string()
      .min(1)
      .refine((p) => p.endsWith(".xlsx"), "relativePath must end in .xlsx")
      .refine((p) => !p.includes(".."), "relativePath may not contain '..'"),
    repos: z.array(z.object({ name: z.string(), cloneUrl: z.string() })).min(1),
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
      throw new Error("No organization resolved on this session.");
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Repos");
    sheet.columns = [
      { header: "Repo Name", key: "name", width: 40 },
      { header: "Clone URL", key: "cloneUrl", width: 70 },
    ];
    for (const repo of input.repos) sheet.addRow(repo);

    const buffer = await workbook.xlsx.writeBuffer();
    const key = `${orgId}/${input.projectSlug}/${input.relativePath}`;

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: projectFilesBucket(),
          Key: key,
          Body: Buffer.from(buffer),
          IfNoneMatch: "*",
          ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      return { saved: true, path: key, repoCount: input.repos.length };
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
