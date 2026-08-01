import Stripe from "stripe";

/**
 * Single shared Stripe client. Test-mode keys only right now (see
 * .env.local) — no live business/banking details submitted to Stripe yet,
 * so no real charge can succeed. Safe to build against.
 */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return new Stripe(key);
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe];
  },
});
