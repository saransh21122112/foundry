import { defineTool } from "eve/tools";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { s3, projectFilesBucket } from "../../../lib/s3-client";

/**
 * Reads back a deliverable saved via save_project_file.ts. Scoped the same
 * way as list_project_files.ts: the `<orgId>/` prefix comes from the
 * session, never from tool input, so `relativePath`/`projectSlug` alone
 * can only ever resolve to a path inside the caller's own org namespace —
 * there is no input shape that reaches another org's blob.
 *
 * riskClass "reversible-low": a pure read, same reasoning as
 * get_activity_summary.ts.
 */
export default defineTool({
  description: "Read back the contents of a file previously saved with save_project_file.",
  inputSchema: z.object({
    projectSlug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
    relativePath: z.string().min(1),
  }),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "eng-lead" }, dbDeps);

    const key = `${orgId}/${input.projectSlug}/${input.relativePath}`;

    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: projectFilesBucket(), Key: key }));
      const contents = await object.Body?.transformToString();
      if (contents === undefined) {
        throw new Error(`Could not read ${input.relativePath} — empty response body.`);
      }
      return { path: input.relativePath, contents };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NoSuchKey") {
        throw new Error(`${input.relativePath} was not found in ${input.projectSlug}.`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  },
});
