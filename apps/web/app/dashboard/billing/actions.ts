"use server";

import { redirect } from "next/navigation";
import { ensureOrganization, organizations, db } from "@foundry/db";
import { eq } from "drizzle-orm";
import { requireOrgAdmin } from "@/lib/authz";
import { stripe } from "@/lib/stripe";

/**
 * Sends this org's admin to a real Stripe Checkout Session for the Pro
 * plan. `client_reference_id` is how the webhook (app/api/webhooks/stripe/
 * route.ts's resolveOrgId) maps the resulting event back to this org — see
 * that file's comment, this is the flow it was waiting on.
 */
export async function startProCheckout(): Promise<never> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  // Same reasoning as packages/guardrails/src/deps-db.ts's APP_URL guard:
  // fail loudly rather than silently sending a customer through Stripe
  // Checkout to a success/cancel URL that resolves to localhost.
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — refusing to start checkout with a broken redirect URL.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3311";
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRO_PRICE_ID is not configured.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: org.id,
    success_url: `${appUrl}/dashboard/billing?upgraded=1`,
    cancel_url: `${appUrl}/dashboard/billing`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL.");
  }
  redirect(session.url);
}

export async function getOrgPlan(): Promise<"free" | "pro"> {
  const { clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [row] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  return (row?.plan as "free" | "pro" | undefined) ?? "free";
}
