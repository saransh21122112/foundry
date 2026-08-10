import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveGithubToken } from "../../../lib/github-connection-auth";

/**
 * Real gap this closes: `list_public_github_repos.ts` only ever sees
 * public repos (plain unauthenticated fetch, by design). The connected
 * GitHub account's *private* repos need the actual OAuth token
 * (github-connection-auth.ts, same one clone_repo.ts uses) — this hits
 * GitHub's `/user/repos` with it, so it's genuinely the connected
 * account's repos, private and public, not a guess or a public-only
 * fallback.
 *
 * riskClass "reversible-low", ungated — same convention as
 * list_public_github_repos.ts and get_daily_ops_digest.ts: a read with no
 * external side effect. The token itself is already scoped by whatever
 * the org granted at connect time (`repo` scope, see
 * dashboard/connections/actions.ts's startGithubConnect) — this tool
 * can't see anything the connection wasn't already authorized to see.
 */
export default defineTool({
  description:
    "List repositories (name, clone URL, private/public) for this organization's connected GitHub account — includes private repos, unlike list_public_github_repos. Requires a GitHub connection at /dashboard/connections.",
  inputSchema: z.object({
    perPage: z.number().int().min(1).max(100).default(100),
  }),
  async execute({ perPage }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    if (typeof orgId !== "string") {
      throw new Error("No organization resolved on this session.");
    }

    const token = await resolveGithubToken(orgId);
    const res = await fetch(`https://api.github.com/user/repos?per_page=${perPage}&sort=updated`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "foundry-app",
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Array<{ name: string; clone_url: string; private: boolean }>;
    const repos = data.map((repo) => ({ name: repo.name, cloneUrl: repo.clone_url, private: repo.private }));

    return { repos, count: repos.length };
  },
});
