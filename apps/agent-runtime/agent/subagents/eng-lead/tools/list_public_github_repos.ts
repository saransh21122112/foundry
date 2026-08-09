import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Fallback for "list this user's GitHub repos" that sidesteps the
 * connection-discovery question entirely: the github connection
 * (connections/github.ts) exposes repos/list-for-authenticated-user, but
 * whether the model actually discovers/calls that operation is a separate,
 * still-open investigation. GitHub's public REST API needs no auth at all
 * for a user's public repos, so this tool is just a plain fetch() — no
 * connection, no OAuth token, no org/session lookup, nothing this app's
 * guardrails need to gate. riskClass reversible-low / gated: false, same
 * convention as data-lead/get_activity_summary.ts and
 * ops-manager/get_daily_ops_digest.ts (both pure reads with no `approval`
 * field at all) — gating a public unauthenticated GET would be
 * inconsistent with how every other pure-read tool here is classified.
 *
 * Output shape — { name, cloneUrl }[] — is deliberately identical to what
 * generate_repos_xlsx.ts's `repos` input expects, so the model can chain
 * this tool straight into that one without any reshaping.
 */
export default defineTool({
  description:
    "List a GitHub user's public repositories (name + clone URL) with no authentication required. " +
    "Use this when the user asks to list repos for a GitHub username and the connected-account " +
    "repo listing isn't available or isn't what's being asked for.",
  inputSchema: z.object({
    username: z
      .string()
      .min(1)
      .max(39)
      .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/,
        "must be a valid GitHub username: alphanumeric characters and single hyphens, no leading/trailing/consecutive hyphens",
      ),
    perPage: z.number().int().min(1).max(100).default(100),
  }),
  async execute(input) {
    const res = await fetch(
      `https://api.github.com/users/${input.username}/repos?per_page=${input.perPage}&type=public`,
      {
        headers: {
          "User-Agent": "foundry-app",
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`GitHub user "${input.username}" does not exist.`);
      }
      throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Array<{ name: string; clone_url: string }>;
    const repos = data.map((repo) => ({ name: repo.name, cloneUrl: repo.clone_url }));

    return { repos, count: repos.length };
  },
});
