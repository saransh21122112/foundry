import { defineOpenAPIConnection } from "eve/connections";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { resolveGithubToken } from "../../../lib/github-connection-auth";

/**
 * Declared subagents inherit nothing from the root by default — a
 * connection only reaches a subagent that has its own `connections/`
 * directory (node_modules/eve/docs/subagents.mdx:66,72). eng-lead only for
 * this pass: swe-lead's nested children (frontend-developer etc.) would
 * need the identical 2-levels-deep approval-resume path that's currently
 * unreliable (see the approval-resume investigation) — extend there once
 * that's fixed, not before.
 *
 * Phase 1 scope (read + comment, no code-writing): opening a real PR needs
 * commits to land in a branch first, which is a separate design problem
 * (either handing the sandbox's bash/git a live credential, or building
 * commits via GitHub's Git Data API through this same connection) — not
 * attempted here.
 *
 * `repos/list-for-authenticated-user` added alongside a real `clone_repo`
 * tool (../tools/clone_repo.ts) that DOES hand the sandbox's git a live
 * credential — the tradeoff flagged above, now accepted for this specific,
 * narrow case (cloning the org's own connected repos), not opened up
 * generally.
 *
 * KNOWN UPSTREAM BUG (eve 0.27.10): `operations.allow` below does NOT
 * actually filter anything. Traced live: `OpenApiConnectionClient`
 * (node_modules/eve/dist/src/runtime/connections/openapi-client.js) reads
 * its filter off `this.#n.tools`, but `defineOpenAPIConnection`'s config
 * field is named `operations`, not `tools` (the MCP client variant
 * correctly reads `.tools` — this looks like a copy-paste that was never
 * renamed for the OpenAPI variant). Since the config object has no `.tools`
 * property, the filter is always `undefined` and every one of GitHub's
 * ~1,220 spec operations is exposed to `connection_search`, not just the
 * ~7 listed here. The `approval` gate below still applies to every call
 * regardless (that's a separate mechanism, unaffected), so this isn't a
 * guardrails bypass — but it does mean the model can *discover* far more
 * than intended, and crowds out operations that should rank well in search
 * (this is why `repos/list-for-authenticated-user` wasn't reliably found
 * by the model in practice — see ../tools/list_public_github_repos.ts,
 * built as a working fallback rather than depending on this being fixed).
 * Real fix is upstream in vercel/eve; not something to patch around here.
 */
export default defineOpenAPIConnection({
  spec: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
  baseUrl: "https://api.github.com",
  description: "Read issues, pull requests, and repository metadata, and post comments, in this organization's connected GitHub account.",
  operations: {
    allow: [
      "issues/list-for-repo",
      "issues/get",
      "issues/create",
      "issues/create-comment",
      "pulls/list",
      "pulls/get",
      "repos/list-for-authenticated-user",
    ],
  },
  auth: (ctx) => ({
    getToken: async () => {
      const orgId = ctx.session.auth.current?.attributes?.orgId;
      if (typeof orgId !== "string") {
        throw new Error("No organization resolved on this session.");
      }
      return { token: await resolveGithubToken(orgId) };
    },
  }),
  approval: makeApprovalPolicy(
    {
      department: "eng-lead",
      riskClass: "reversible-high",
      estimatedCost: { unit: "github_calls", amount: 1 },
    },
    dbDeps,
  ),
});
