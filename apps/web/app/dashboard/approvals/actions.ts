"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { approvalRequests, db, ensureOrganization } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";
import { resumeEveApproval } from "@/lib/eve-client";

/**
 * Resolves a pending approval_requests row AND resumes the actual parked
 * eve agent session — see lib/eve-client.ts for the resume mechanics
 * (recovering `continuationToken` via a stream tail-read, then a plain
 * "approve"/"deny" follow-up message; written against
 * node_modules/eve/docs/concepts/sessions-runs-and-streaming.md, not
 * guessed). Admin-only (lib/authz.ts) — approving spend or a gated action
 * isn't something any signed-in org member should be able to do.
 *
 * Order matters: our own DB row is updated first (source of truth for
 * "was this decided, and by whom"), then the session resume is attempted.
 * If the resume call fails — stale session, agent-runtime unreachable —
 * the decision is still recorded; the error surfaces to the admin rather
 * than silently leaving a parked session dangling.
 */
export async function resolveApproval(formData: FormData) {
  const { userId, clerkOrgId, orgSlug, getToken } = await requireOrgAdmin();

  const approvalId = formData.get("approvalId");
  const decision = formData.get("decision");
  if (
    typeof approvalId !== "string" ||
    (decision !== "approved" && decision !== "rejected")
  ) {
    throw new Error("Invalid form submission.");
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  // Scope to this org explicitly — never resolve a request just because
  // someone has the uuid; it must belong to the caller's own tenant, and
  // must still be pending (no re-resolving an already-decided request).
  const [updated] = await db
    .update(approvalRequests)
    .set({ status: decision, resolvedAt: new Date(), resolvedByClerkUserId: userId })
    .where(
      and(
        eq(approvalRequests.id, approvalId),
        eq(approvalRequests.orgId, org.id),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .returning({ id: approvalRequests.id, agentRunId: approvalRequests.agentRunId });

  if (!updated) {
    throw new Error("Approval request not found, already resolved, or not in this organization.");
  }

  const token = await getToken();
  if (!token) throw new Error("Could not obtain a session token to resume the agent.");
  await resumeEveApproval(updated.agentRunId, decision, token);

  revalidatePath("/dashboard/approvals");
}
