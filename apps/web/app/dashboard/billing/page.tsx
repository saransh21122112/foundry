import { getOrgPlan, startProCheckout } from "./actions";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const plan = await getOrgPlan();
  const { upgraded } = await searchParams;

  return (
    <main>
      <p className="eyebrow">Billing</p>
      <h1>Plan</h1>
      <p className="lede">
        Free caps you at 2 active departments and <span className="mono">draft_only</span> autonomy. Pro removes both ceilings.
      </p>

      {upgraded && plan === "free" && (
        <p className="panel" style={{ color: "var(--iron)" }}>
          Checkout completed — this can take a few seconds to reflect here while Stripe's webhook lands. Refresh shortly.
        </p>
      )}

      <div className="panel">
        <p className="eyebrow" style={{ marginBottom: 2 }}>Current plan</p>
        <h2 className="mono" style={{ fontSize: 20, textTransform: "uppercase", margin: "0 0 16px" }}>{plan}</h2>

        {plan === "free" ? (
          <form action={startProCheckout}>
            <button type="submit" className="btn btn-primary">
              Upgrade to Pro — $29/mo
            </button>
          </form>
        ) : (
          <p style={{ color: "var(--iron)", margin: 0 }}>You&apos;re on Pro. No department limit, autonomy up to bounded_autonomous.</p>
        )}
      </div>
    </main>
  );
}
