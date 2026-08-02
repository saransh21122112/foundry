/**
 * Pure decision logic extracted from deps-db.ts's checkAndReserveBudget, so
 * the rollover/comparison/update-list logic can be tested without a DB. No
 * I/O here — checkAndReserveBudget fetches the rows, calls this, and applies
 * `updates` via db.update() itself.
 */

export interface BudgetCapRow {
  id: string;
  department: string | null;
  scope: "per_run" | "daily" | "monthly";
  unit: string;
  capAmount: number;
  periodStart: Date;
  currentSpend: number;
}

export interface BudgetDecision {
  verdict: "allow" | "deny";
  updates: Array<{ id: string; currentSpend: number; periodStart?: Date }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export function computeBudgetDecision(
  rows: BudgetCapRow[],
  cost: { unit: string; amount: number },
  now: Date,
): BudgetDecision {
  // No cap rows to check against = nothing to block or update. In practice
  // checkAndReserveBudget already early-returns { withinBudget: true } before
  // calling this when rows.length === 0 — this branch just keeps the pure
  // function total or so callers don't have to special-case an empty input.
  if (rows.length === 0) return { verdict: "allow", updates: [] };

  const nowMs = now.getTime();

  // Rollover-adjusted effective spend per row, computed before any decision
  // is made — every row must be checked before any is written.
  const effective = rows.map((row) => {
    if (row.scope === "per_run") {
      return { row, rolledOver: false, currentSpend: 0 };
    }
    const windowMs = row.scope === "daily" ? DAY_MS : MONTH_MS;
    const rolledOver = nowMs - row.periodStart.getTime() > windowMs;
    return { row, rolledOver, currentSpend: rolledOver ? 0 : row.currentSpend };
  });

  for (const { row, currentSpend } of effective) {
    const projected = row.scope === "per_run" ? cost.amount : currentSpend + cost.amount;
    if (projected > row.capAmount) {
      return { verdict: "deny", updates: [] };
    }
  }

  const updates: BudgetDecision["updates"] = [];
  for (const { row, rolledOver, currentSpend } of effective) {
    if (row.scope === "per_run") continue; // not cumulative, never persisted
    updates.push({
      id: row.id,
      currentSpend: currentSpend + cost.amount,
      ...(rolledOver ? { periodStart: now } : {}),
    });
  }
  return { verdict: "allow", updates };
}
