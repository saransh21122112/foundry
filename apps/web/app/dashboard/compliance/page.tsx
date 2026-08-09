import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, ensureOrganization, organizations } from "@foundry/db";
import { computeComplianceReport } from "@/lib/compliance";
import { COMPLIANCE_COPY } from "@/lib/copy";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parsePeriodParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ periodStart?: string; periodEnd?: string }>;
}) {
  const { orgId: clerkOrgId, orgSlug, has } = await auth();
  const { periodStart: periodStartParam, periodEnd: periodEndParam } = await searchParams;

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Compliance</h1>
        <p className="lede">Sign in and select or create an organization to see its compliance record.</p>
      </main>
    );
  }

  if (!has({ role: "org:admin" })) {
    return (
      <main>
        <h1>Compliance</h1>
        <p className="lede">Only an organization admin can view the compliance export.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const [orgRow] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  const plan = orgRow?.plan ?? "free";

  if (plan !== "pro") {
    return (
      <main>
        <p className="eyebrow">Compliance</p>
        <h1>Audit export</h1>
        <p className="lede">{COMPLIANCE_COPY.upsellBody}</p>
        <div className="panel">
          <p className="eyebrow" style={{ marginBottom: 8 }}>{COMPLIANCE_COPY.upsellTitle}</p>
          <a href="/dashboard/billing" className="btn btn-primary">
            {COMPLIANCE_COPY.upsellCta}
          </a>
        </div>
      </main>
    );
  }

  const now = new Date();
  const defaultStart = new Date(now.getTime() - 30 * DAY_MS);
  const periodStart = parsePeriodParam(periodStartParam, defaultStart);
  const periodEnd = parsePeriodParam(periodEndParam, now);

  const report = await computeComplianceReport(org.id, periodStart, periodEnd);
  const exportQuery = `periodStart=${periodStart.toISOString()}&periodEnd=${periodEnd.toISOString()}`;
  const hasViolations = report.claimA.violations.length > 0 || report.claimB.violations.length > 0;

  return (
    <main>
      <p className="eyebrow">Compliance</p>
      <h1>Audit export</h1>
      <p className="lede">
        Proof every irreversible, financial, or legal action your agents took had your sign-off first — and that
        everything you rejected actually stayed rejected.
      </p>

      <form method="GET" className="field-row" style={{ marginBottom: 16 }}>
        <div>
          <label htmlFor="periodStart" className="eyebrow" style={{ display: "block", marginBottom: 4 }}>From</label>
          <input type="date" id="periodStart" name="periodStart" defaultValue={toDateInputValue(periodStart)} />
        </div>
        <div>
          <label htmlFor="periodEnd" className="eyebrow" style={{ display: "block", marginBottom: 4 }}>To</label>
          <input type="date" id="periodEnd" name="periodEnd" defaultValue={toDateInputValue(periodEnd)} />
        </div>
        <button type="submit" className="btn">Update range</button>
      </form>

      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{COMPLIANCE_COPY.claimALabel}</p>
        <p className="mono" style={{ margin: 0 }}>
          {report.claimA.matched} / {report.claimA.total} matched
          {report.claimA.violations.length > 0 && (
            <span style={{ color: "var(--ember-hot)" }}> — {report.claimA.violations.length} violation(s)</span>
          )}
        </p>
        {report.claimA.total === 0 && (
          <p style={{ color: "var(--iron)", marginTop: 8 }}>{COMPLIANCE_COPY.noHardRiskRows}</p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{COMPLIANCE_COPY.claimBLabel}</p>
        <p className="mono" style={{ margin: 0 }}>
          {report.claimB.correctlyBlocked} / {report.claimB.totalRejected} honored
          {report.claimB.violations.length > 0 && (
            <span style={{ color: "var(--ember-hot)" }}> — {report.claimB.violations.length} violation(s)</span>
          )}
        </p>
        {report.claimB.totalRejected === 0 && (
          <p style={{ color: "var(--iron)", marginTop: 8 }}>No rejected high-risk attempts in this period.</p>
        )}
      </div>

      {hasViolations && (
        <div className="panel" style={{ marginBottom: 16, borderColor: "var(--ember-hot)" }}>
          <p className="eyebrow" style={{ marginBottom: 8, color: "var(--ember-hot)" }}>Violations found</p>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Department</th>
                <th>Tool</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {report.claimA.violations.map((v) => (
                <tr key={`a-${v.id}`}>
                  <td>Unapproved execution</td>
                  <td className="mono">{v.department}</td>
                  <td className="mono">{v.toolName}</td>
                  <td className="mono">{v.timestamp.toLocaleString()}</td>
                </tr>
              ))}
              {report.claimB.violations.map((v) => (
                <tr key={`b-${v.id}`}>
                  <td>Executed after rejection</td>
                  <td className="mono">{v.department}</td>
                  <td className="mono">{v.toolName}</td>
                  <td className="mono">{v.resolvedAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Content hash</p>
        <p className="mono" style={{ wordBreak: "break-all", margin: "0 0 8px" }}>{report.contentHash}</p>
        <p style={{ color: "var(--iron)", marginBottom: 16 }}>{COMPLIANCE_COPY.integrityNote}</p>
        <a href={`/dashboard/compliance/export?${exportQuery}`} className="btn btn-primary" style={{ marginRight: 8 }}>
          {COMPLIANCE_COPY.exportCta}
        </a>
        <a href={`/dashboard/compliance/report?${exportQuery}`} className="btn">
          {COMPLIANCE_COPY.reportCta}
        </a>
      </div>
    </main>
  );
}
