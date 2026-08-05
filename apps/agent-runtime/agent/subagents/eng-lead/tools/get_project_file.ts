import { defineTool } from "eve/tools";
import { z } from "zod";
import { get } from "@vercel/blob";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

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

    const pathname = `${orgId}/${input.projectSlug}/${input.relativePath}`;
    const blob = await get(pathname, { access: "private" });
    if (!blob) {
      throw new Error(`${input.relativePath} was not found in ${input.projectSlug}.`);
    }
    if (blob.statusCode !== 200) {
      throw new Error(`Could not read ${input.relativePath} (status ${blob.statusCode}).`);
    }

    const contents = await new Response(blob.stream).text();
    return { path: input.relativePath, contents };
  },
});
