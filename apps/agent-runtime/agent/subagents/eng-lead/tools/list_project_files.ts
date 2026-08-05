import { defineTool } from "eve/tools";
import { z } from "zod";
import { list } from "@vercel/blob";
import { assertNotKilled } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";

/**
 * Lists deliverables previously saved via save_project_file.ts, scoped to
 * this org's own `<orgId>/` prefix — the read-side counterpart that tool's
 * write path was missing (found live, 2026-08-05: nothing could retrieve
 * what got saved). `prefix` is built from the session's own orgId, same as
 * save_project_file.ts, never from tool input — a customer's agent can't
 * list another org's files by any input it could construct.
 *
 * riskClass "reversible-low": a pure read, same reasoning as
 * get_activity_summary.ts.
 */
export default defineTool({
  description:
    "List saved project deliverables for this organization, optionally scoped to one project. Returns pathnames and metadata, not file contents — use get_project_file to read one.",
  inputSchema: z.object({
    projectSlug: z
      .string()
      .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only")
      .optional(),
  }),
  async execute(input, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }
    await assertNotKilled({ orgId, department: "eng-lead" }, dbDeps);

    const prefix = input.projectSlug ? `${orgId}/${input.projectSlug}/` : `${orgId}/`;
    const { blobs } = await list({ access: "private", prefix, mode: "expanded" });

    return {
      files: blobs.map((b) => ({
        // Strip the orgId prefix — the caller's own tools/DB never need it,
        // and it shouldn't leak into what an agent then repeats back to a user.
        path: b.pathname.slice(orgId.length + 1),
        size: b.size,
        uploadedAt: b.uploadedAt,
      })),
    };
  },
});
