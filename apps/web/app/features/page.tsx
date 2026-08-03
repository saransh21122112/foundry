import { DEPARTMENTS } from "@foundry/shared-types";
import { AutonomyGauge } from "@/components/AutonomyGauge";
import { MarketingLinks } from "@/components/MarketingLinks";
import { DEPARTMENT_BLURB } from "@/lib/copy";

/**
 * The guardrail pipeline every tool call passes through, in order — mirrors
 * packages/guardrails/src/enforce.ts and the prose already on /about. This
 * page renders it as a checklist instead of a paragraph, since "the
 * guardrails" are the actual product differentiator, not a feature among
 * others.
 */
const PIPELINE = [
  { name: "Kill switch", detail: "Org-wide or per-department. Blocks everything instantly." },
  { name: "Department on/off", detail: "A department not turned on does nothing at all." },
  { name: "Autonomy level", detail: "Off, drafts-only, or bounded-autonomous — set per department, changeable any time." },
  {
    name: "Hard-coded approval rules",
    detail: "Irreversible, financial, or legal actions always pause for you. No configuration can widen past this.",
  },
  { name: "Budget cap", detail: "A spending ceiling with automatic rollover." },
  { name: "Tool allowlist", detail: "Turn off one specific action without turning off the whole department." },
  { name: "Rate limit", detail: "Caps how fast a department can act, even inside its budget." },
] as const;

export default function FeaturesPage() {
  return (
    <main className="hero" style={{ maxWidth: 860 }}>
      <p className="eyebrow">Features</p>
      <h1>Seven department agents. One chokepoint they all run through.</h1>
      <p className="lede">
        Every action any agent attempts — before it runs, not after — passes
        through the same pipeline, in this order. Nothing skips a step, and
        no per-department setting can widen the hard-coded rules.
      </p>

      <div className="panel" style={{ marginBottom: 32 }}>
        <p className="eyebrow" style={{ marginBottom: 14 }}>The pipeline</p>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 14 }}>
          {PIPELINE.map((step, i) => (
            <li key={step.name} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span
                className="mono"
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "var(--iron)",
                }}
              >
                {i + 1}
              </span>
              <div>
                <p style={{ margin: 0, color: "var(--paper)", fontWeight: 600 }}>{step.name}</p>
                <p style={{ margin: "2px 0 0", color: "var(--iron)", fontSize: 13 }}>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p style={{ marginTop: 16, marginBottom: 0, color: "var(--iron-dim)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          Every step — allowed, blocked, or paused for approval — is written to a full activity log.
        </p>
      </div>

      <p className="eyebrow" style={{ marginBottom: 2 }}>Departments</p>
      <h2 style={{ fontSize: 22 }}>Turn on what you need. Each one runs at the heat you allow.</h2>
      <p className="lede">
        Departments default to off. The gauge below shows the same
        autonomy readout used in your dashboard — off, drafting, or
        autonomous.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 32 }}>
        {DEPARTMENTS.map((department) => (
          <div className="panel" key={department} style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
              <h3 className="mono" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.03em", margin: 0 }}>
                {department}
              </h3>
              <AutonomyGauge level="draft_only" />
            </div>
            <p style={{ margin: 0, color: "var(--iron)", fontSize: 13 }}>{DEPARTMENT_BLURB[department]}</p>
          </div>
        ))}
      </div>

      <p className="lede">
        Plus per-tenant custom agent prompts, so each department acts the
        way your organization actually works — not a generic default. See{" "}
        <a href="/about">how it works</a> for the full guardrails writeup, or{" "}
        <a href="/pricing">pricing</a> for what&apos;s in Free vs Pro.
      </p>

      <MarketingLinks current="/features" />
    </main>
  );
}
