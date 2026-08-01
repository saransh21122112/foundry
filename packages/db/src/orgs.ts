import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { organizations } from "./schema.js";

/**
 * Resolves a Clerk organization id to our internal `organizations.id`
 * (uuid) — lazily creating the row the first time this Clerk org is seen.
 *
 * Every table in packages/guardrails' guardrail chain (department_configs,
 * budget_caps, tool_allowlists, approval_requests, activity_log,
 * kill_switches) foreign-keys against `organizations.id`, never the raw
 * Clerk org id string — so this must be the ONLY place a Clerk org id gets
 * converted into a tenant id. Call this once per request/session (route
 * auth, or a dashboard page's first render) and pass the resulting uuid
 * downstream; never pass a raw `org_xxx` Clerk id into enforce() or any
 * guardrails query.
 *
 * `name`/`slug` are best-effort — Clerk's default session token exposes
 * `org_slug` but not the full org name, so both fall back to the slug
 * until a proper sync (webhook or dashboard on-visit refresh) fills in
 * the real name. Fine for now: nothing downstream reads `name` for
 * anything security-relevant.
 */
export async function ensureOrganization(input: {
  clerkOrgId: string;
  name?: string;
  slug?: string;
}): Promise<{ id: string }> {
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.clerkOrgId, input.clerkOrgId))
    .limit(1);
  if (existing[0]) return existing[0];

  const fallback = input.slug ?? input.clerkOrgId;
  const [created] = await db
    .insert(organizations)
    .values({
      clerkOrgId: input.clerkOrgId,
      name: input.name ?? fallback,
      slug: fallback,
    })
    // Two concurrent first-requests for the same brand-new org could both
    // reach the insert; let the unique index win and re-select rather than
    // erroring.
    .onConflictDoNothing({ target: organizations.clerkOrgId })
    .returning({ id: organizations.id });

  if (created) return created;

  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.clerkOrgId, input.clerkOrgId))
    .limit(1);
  return row;
}
