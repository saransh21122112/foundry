"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, ensureOrganization, integrations } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";

/**
 * Saves (or replaces) this org's outbound webhook connection — a
 * customer-owned Slack/Discord/Zapier "incoming webhook URL", stored in
 * `integrations.config` per the schema's comment on that column. Upserts
 * on (orgId, provider="webhook"), matching the unique index
 * `integrations_org_provider_idx`. Admin-only, same gate as budgets.
 *
 * Validation here is deliberately shallow: syntactically-valid `https://`
 * URL only. Confirming it's a *real* Slack/Discord endpoint would need a
 * live test-POST, which is out of scope for save-time validation — the
 * post_webhook tool's own execution is where a bad URL actually surfaces.
 */
export async function saveWebhookConnection(formData: FormData) {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();

  const url = formData.get("url");
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("A webhook URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must be https://.");
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "webhook")))
    .limit(1);

  if (existing[0]) {
    await db
      .update(integrations)
      .set({ config: { url: parsed.toString() }, status: "active", connectedByClerkUserId: userId })
      .where(eq(integrations.id, existing[0].id));
  } else {
    await db.insert(integrations).values({
      orgId: org.id,
      provider: "webhook",
      config: { url: parsed.toString() },
      status: "active",
      connectedByClerkUserId: userId,
    });
  }

  revalidatePath("/dashboard/connections");
}

/**
 * Deletes this org's webhook connection row outright rather than setting
 * status="revoked" — there's nothing worth keeping a revoked row around
 * for (no history/audit view reads it), and deleting keeps the upsert
 * above simple (no stale revoked row to reactivate).
 */
export async function removeWebhookConnection() {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  await db
    .delete(integrations)
    .where(and(eq(integrations.orgId, org.id), eq(integrations.provider, "webhook")));

  revalidatePath("/dashboard/connections");
}
