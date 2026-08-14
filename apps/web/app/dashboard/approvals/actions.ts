"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { approvalRequests, db, ensureOrganization } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";
import { resumeEveApproval } from "@/lib/eve-client";

/**
 * Resolves a pending approval_requests row, then kicks off (without
 * awaiting) the actual resume of the parked eve agent session — see
 * lib/eve-client.ts for the resume mechanics (recovering
 * `continuationToken` via a stream tail-read, then a plain "approve"/"deny"
 * follow-up message; written against
 * node_modules/eve/docs/concepts/sessions-runs-and-streaming.md, not
 * guessed). Admin-only (lib/authz.ts) — approving spend or a gated action
 * isn't something any signed-in org member should be able to do.
 *
 * Used to `await resumeEveApproval` before returning. Confirmed live: for a
 * real multi-step delegation + tool-execution resume, that whole round trip
 * can take longer than CloudFront's 60s origin response timeout (see
 * infra/lib/foundry-stack.ts's own comment on this ceiling — not
 * configurable without an AWS support quota increase), so the admin's
 * browser got a bare 504 with no way to tell whether the resume actually
 * went through. The DB row is the real source of "was this decided, and by
 * whom" and is updated FIRST, synchronously — the approvals list is
 * already filtered to `status: "pending"`, so the row disappears from the
 * queue the instant this returns, regardless of how long the underlying
 * agent resume takes. The resume itself keeps running after the response
 * is sent (this is a persistent ECS server, not a serverless function that
 * gets frozen on return) — failures are still real, just no longer
 * blocking or surfaced synchronously to the admin; they're logged
 * server-side instead. A visible "resume failed" indicator in the UI is a
 * reasonable follow-up, not built here.
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

  // Not awaited — see the function doc for why. Errors here can no longer
  // reach the admin synchronously, so log with enough context to find the
  // row again (agentRunId) instead of letting them vanish silently.
  resumeEveApproval(updated.agentRunId, decision, token).catch((err) => {
    console.error(`[resolveApproval] background resume failed for session ${updated.agentRunId} (decision: ${decision}):`, err);
  });

  revalidatePath("/dashboard/approvals");
}
