import { MarketingLinks } from "@/components/MarketingLinks";

export default function AboutPage() {
  return (
    <main className="hero" style={{ maxWidth: 760 }}>
      <p className="eyebrow">About</p>
      <h1>An AI company you can actually trust with the keys</h1>
      <p className="lede">
        Foundry is a platform where an organization configures real
        autonomous AI department agents — engineering, product, research,
        operations, design, data, sales — that take real actions on your
        behalf: writing files, running code in a sandbox, sending outreach
        email, and more. Each department runs only as hot as you allow it.
      </p>

      <h2 style={{ marginTop: 8 }}>Guardrails first, not bolted on</h2>
      <p className="lede">
        Every action any agent attempts passes through a single chokepoint
        before it runs. In order: an org-wide or per-department{" "}
        <strong>kill switch</strong> that blocks everything instantly,
        whether the department is turned on at all, the{" "}
        <strong>autonomy level</strong> you've set for that department (off,
        drafts-only, or bounded-autonomous), hard-coded rules that always
        pause for your approval on anything irreversible, financial, or
        legal — no configuration can widen past that ceiling — a{" "}
        <strong>budget cap</strong> with automatic rollover, a{" "}
        <strong>tool allowlist</strong>, and a rate limit. Every step, on
        every path — allowed, blocked, or paused for approval — is written to
        a full activity log, so nothing an agent attempts is invisible after
        the fact.
      </p>
      <p className="lede">
        You also get per-tenant custom agent prompts, so a department agent
        acts the way your organization actually works, not a generic
        default.
      </p>
      <p className="lede">
        See the <a href="/features">full pipeline and department roster →</a>
      </p>

      <h2 style={{ marginTop: 8 }}>Early, and built in the open</h2>
      <p className="lede">
        Foundry is early. There are no live paying customers yet, and we'd
        rather tell you that plainly than oversell it. What's here today —
        the guardrail pipeline, the kill switch, the activity log — is real
        and running, not a mockup. We're building it in the open and taking
        it seriously precisely because these agents take real actions.
      </p>

      <MarketingLinks current="/about" />
    </main>
  );
}
