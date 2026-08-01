import { headers } from "next/headers";
import { stripe } from "@/lib/stripe";

/**
 * Stripe webhook receiver. Not usable yet — STRIPE_WEBHOOK_SECRET isn't
 * set anywhere (Stripe only issues one once a webhook endpoint is
 * registered against a reachable URL, which means an actual deployment or
 * an `stripe listen` tunnel — neither exists yet, Phase 4 work). The
 * signature-verification logic below is real, not a placeholder; only the
 * secret and the event-handling switch cases are missing.
 *
 * Once wired: this is where a completed Checkout Session or subscription
 * update should map to `department_configs`/`budget_caps` changes (see
 * packages/db/src/schema.ts) — e.g. upgrading a plan raises budget caps,
 * a cancelled subscription should probably force autonomy_level back to
 * draft_only rather than silently keep bounded_autonomous running unpaid.
 * That mapping is a product decision, not written yet.
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
    // TODO(Phase 4): checkout.session.completed, customer.subscription.updated,
    // customer.subscription.deleted — map to department_configs/budget_caps.
    default:
      break;
  }

  return new Response(null, { status: 200 });
}
