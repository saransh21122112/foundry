import type { AutonomyLevel } from "@foundry/shared-types";

const LABELS: Record<AutonomyLevel, string> = {
  off: "Off",
  draft_only: "Drafting",
  bounded_autonomous: "Autonomous",
};

/**
 * The signature element: a 3-segment heat readout for a department's
 * autonomy_level. This isn't decoration — it's a direct visualization of
 * the actual enforce() gate (packages/guardrails/src/enforce.ts) that
 * decides whether a tool call executes, gets queued, or is denied.
 */
export function AutonomyGauge({ level }: { level: AutonomyLevel }) {
  return (
    <span className="gauge" data-level={level}>
      <span className="gauge-track" aria-hidden="true">
        <span className="gauge-seg" />
        <span className="gauge-seg" />
        <span className="gauge-seg" />
      </span>
      {LABELS[level]}
    </span>
  );
}
