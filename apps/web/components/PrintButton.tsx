"use client";

/** Triggers the browser's native Print dialog — the actual PDF delivery
 * mechanism for /dashboard/compliance/report, no PDF-rendering dependency
 * needed. Hidden itself via .no-print in globals.css when actually printing. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
