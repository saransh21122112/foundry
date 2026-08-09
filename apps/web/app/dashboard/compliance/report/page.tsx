import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, organizations } from "@foundry/db";
import { eq } from "drizzle-orm";
import { computeComplianceReport } from "@/lib/compliance";
import { COMPLIANCE_COPY } from "@/lib/copy";
import { PrintButton } from "@/components/PrintButton";

const DAY_MS = 24 * 60 * 60 * 1000;

function parsePeriodParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * Print-first version of /dashboard/compliance — same computeComplianceReport
 * data, laid out for the browser's own Print > Save as PDF (see PrintButton
 * and globals.css's `@media print` block, which hides the dashboard rail).
 * No PDF-rendering dependency: the browser is the renderer.
 */
export default async function ComplianceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ periodStart?: string; periodEnd?: string }>;
}) {
  const { orgId: clerkOrgId, orgSlug, has } = await auth();
  const { periodStart: periodStartParam, periodEnd: periodEndParam } = await searchParams;

  if (!clerkOrgId || !has({ role: "org:admin" })) {
    return (
      <main>
        <h1>Compliance report</h1>
        <p className="lede">Sign in as an organization admin to view this report.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [orgRow] = await db
    .select({ plan: organizations.plan, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  if ((orgRow?.plan ?? "free") !== "pro") {
    return (
      <main>
        <h1>Compliance report</h1>
        <p className="lede">{COMPLIANCE_COPY.upsellBody}</p>
      </main>
    );
  }

  const now = new Date();
  const periodStart = parsePeriodParam(periodStartParam, new Date(now.getTime() - 30 * DAY_MS));
  const periodEnd = parsePeriodParam(periodEndParam, now);
  const report = await computeComplianceReport(org.id, periodStart, periodEnd);

  return (
    <main>
      <PrintButton />
      <p className="eyebrow">Compliance report</p>
      <h1>{orgRow?.name ?? org.id}</h1>
      <p className="lede">
        Period {periodStart.toISOString()} — {periodEnd.toISOString()}, generated {now.toISOString()}.
      </p>
      <p className="mono" style={{ wordBreak: "break-all", marginBottom: 24 }}>Content hash: {report.contentHash}</p>

      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{COMPLIANCE_COPY.claimALabel}</p>
        <p style={{ margin: 0 }}>
          {report.claimA.matched} / {report.claimA.total} matched.{" "}
          {report.claimA.violations.length > 0
            ? `${report.claimA.violations.length} violation(s).`
            : "No violations."}
        </p>
        {report.claimA.total === 0 && <p style={{ color: "var(--iron)" }}>{COMPLIANCE_COPY.noHardRiskRows}</p>}
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{COMPLIANCE_COPY.claimBLabel}</p>
        <p style={{ margin: 0 }}>
          {report.claimB.correctlyBlocked} / {report.claimB.totalRejected} honored.{" "}
          {report.claimB.violations.length > 0
            ? `${report.claimB.violations.length} violation(s).`
            : "No violations."}
        </p>
      </div>

      <h2 className="eyebrow">Activity log rows (irreversible / financial / legal only)</h2>
      <div className="panel" style={{ marginBottom: 24 }}>
        {report.rows.activityLog.length === 0 ? (
          <p className="panel-empty">None in this period.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Department</th>
                <th>Tool</th>
                <th>Risk class</th>
                <th>Agent run</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.activityLog.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.timestamp.toISOString()}</td>
                  <td>{r.department}</td>
                  <td className="mono">{r.toolName}</td>
                  <td>{r.riskClass}</td>
                  <td className="mono">{r.agentRunId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="eyebrow">Approval requests (resolved this period)</h2>
      <div className="panel" style={{ marginBottom: 24 }}>
        {report.rows.approvalRequests.length === 0 ? (
          <p className="panel-empty">None in this period.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Resolved</th>
                <th>Department</th>
                <th>Tool</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Agent run</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.approvalRequests.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.resolvedAt.toISOString()}</td>
                  <td>{r.department}</td>
                  <td className="mono">{r.toolName}</td>
                  <td>{r.status}</td>
                  <td>{r.reason}</td>
                  <td className="mono">{r.agentRunId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ color: "var(--iron)" }}>{COMPLIANCE_COPY.integrityNote}</p>
    </main>
  );
}
