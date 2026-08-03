import { MarketingLinks } from "@/components/MarketingLinks";

/**
 * Real plan gating only — mirrors app/dashboard/departments/actions.ts
 * (FREE_PLAN_MAX_DEPARTMENTS = 2, free plan can't set bounded_autonomous).
 * No dollar figures: Stripe is wired (lib/stripe.ts, webhooks/stripe) but
 * plan pricing itself hasn't been designed yet (ROADMAP.md Phase "Stripe
 * billing" — account + client done, "plan design not started"). Don't
 * invent a number here; this page states what's real and defers price.
 */
export default function PricingPage() {
  return (
    <main className="hero" style={{ maxWidth: 860 }}>
      <p className="eyebrow">Pricing</p>
      <h1>Two plans. The difference is how hot you're allowed to run.</h1>
      <p className="lede">
        Every org starts on Free. Pro removes the ceiling — it doesn't add
        features Free doesn't have access to at all.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
          marginBottom: 28,
        }}
      >
        <div className="panel">
          <p className="eyebrow" style={{ marginBottom: 2 }}>Free</p>
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>Get the guardrails running</h2>
          <ul style={{ margin: 0, padding: "0 0 0 18px", color: "var(--iron)", lineHeight: 1.8 }}>
            <li>Up to 2 departments active at once</li>
            <li>
              Autonomy capped at <span className="mono">draft_only</span> — agents
              draft, you approve every action
            </li>
            <li>Full guardrail pipeline: kill switch, budget caps, tool allowlist, activity log</li>
            <li>Per-tenant custom agent prompts</li>
          </ul>
        </div>

        <div className="panel" style={{ borderColor: "var(--ember)" }}>
          <p className="eyebrow" style={{ marginBottom: 2, color: "var(--ember)" }}>Pro</p>
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>Let it run bounded-autonomous</h2>
          <ul style={{ margin: 0, padding: "0 0 0 18px", color: "var(--iron)", lineHeight: 1.8 }}>
            <li>No department limit</li>
            <li>
              Autonomy up to <span className="mono">bounded_autonomous</span> —
              agents act on their own inside the guardrails you set
            </li>
            <li>Everything in Free</li>
            <li>Hard-coded approval-required actions (irreversible, financial, legal) still always pause, on every plan</li>
          </ul>
          <p style={{ marginTop: 16, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--iron-dim)" }}>
            Pricing for Pro isn&apos;t set yet — Foundry is pre-launch. Sign up
            free and we&apos;ll reach out before anything is charged.
          </p>
        </div>
      </div>

      <MarketingLinks current="/pricing" />
    </main>
  );
}
