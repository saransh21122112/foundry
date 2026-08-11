/**
 * Shared by exec_host.ts and clone_repo.ts — the one remaining safety
 * net for host-touching tools after `ALLOW_HOST_EXEC` was removed (see
 * both tools' own doc comments for the full reasoning). Flips the old
 * gate's polarity: a normal single-org deployment (the default) needs no
 * flag and gets zero friction; only a deployment explicitly marked
 * `FOUNDRY_SHARED_INSTANCE=true` opts into the restriction.
 *
 * NOT the same thing as DEPLOY.md §6 ("extending an existing shared
 * instance", deploying a second independently-`orgName`-scoped stack) —
 * that's a fully isolated stack, no risk, no flag needed. This flag is
 * for the narrower, real case: running the **default** stack itself with
 * more than one row in its own `organizations` table (see
 * ARCHITECTURE.md's "Deployment model" section) — one database, one
 * container, genuinely multiple orgs, no isolation between them for a
 * host-execution tool beyond the approval gate.
 */
export function assertNotSharedInstance(toolName: string): void {
  if (process.env.FOUNDRY_SHARED_INSTANCE === "true") {
    throw new Error(
      `${toolName} is disabled on this deployment because FOUNDRY_SHARED_INSTANCE=true — this tool has ` +
        "no per-org isolation, so it can't run safely on an instance serving more than one organization. " +
        "See DEPLOY.md.",
    );
  }
}
