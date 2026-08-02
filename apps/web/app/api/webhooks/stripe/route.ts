import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, organizations } from "@foundry/db";
import { stripe } from "@/lib/stripe";

/**
 * Maps a Stripe event back to our internal org id. Convention: whichever
 * flow creates the Checkout Session must set `metadata.orgId` (or
 * `client_reference_id`) to `organizations.id`. Nothing in this codebase
 * creates a Checkout Session yet (grepped — no `checkout.sessions.create`
 * call, no `client_reference_id` usage anywhere), so this always returns
 * null today; wiring it up is a separate, unscoped feature. Once that flow
 * exists, both a `checkout.session.completed` session and a
 * `customer.subscription.updated` event's subscription carry `metadata`
 * (subscriptions inherit Checkout's metadata when created via Checkout).
 */
function resolveOrgId(object: { metadata?: Stripe.Metadata | null; client_reference_id?: string | null }): string | null {
  return object.metadata?.orgId ?? object.client_reference_id ?? null;
}

async function setOrgPlan(orgId: string, plan: "free" | "pro") {
  await db.update(organizations).set({ plan }).where(eq(organizations.id, orgId));
}

/**
 * Stripe webhook receiver. Not usable yet — STRIPE_WEBHOOK_SECRET isn't
 * set anywhere (Stripe only issues one once a webhook endpoint is
 * registered against a reachable URL, which means an actual deployment or
 * an `stripe listen` tunnel — neither exists yet, Phase 4 work). The
 * signature-verification logic below is real, not a placeholder, and the
 * event-handling switch cases below now flip `organizations.plan` between
 * "free"/"pro" — but see resolveOrgId()'s comment: nothing in this codebase
 * creates a Checkout Session yet, so no live event will actually carry an
 * org id until that flow is built. A cancelled subscription only resets
 * `plan` to "free" here; it deliberately does NOT force any org's
 * `autonomyLevel` back to draft_only (department_configs is untouched) —
 * that's a separate product decision, not written yet.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Stripe webhook secret not configured yet.", { status: 501 });
  }

  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header.", { status: 400 });
  }

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = resolveOrgId(session);
      if (orgId) await setOrgPlan(orgId, "pro");
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = resolveOrgId(subscription);
      if (orgId) {
        const active = subscription.status === "active" || subscription.status === "trialing";
        await setOrgPlan(orgId, active ? "pro" : "free");
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = resolveOrgId(subscription);
      if (orgId) await setOrgPlan(orgId, "free");
      break;
    }
    default:
      break;
  }

  return new Response(null, { status: 200 });
}
