import { NextRequest } from "next/server";
import { complianceExports, db, ensureOrganization } from "@foundry/db";
import { requireOrgAdmin } from "@/lib/authz";
import { computeComplianceReport } from "@/lib/compliance";

const DAY_MS = 24 * 60 * 60 * 1000;

function parsePeriodParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * Downloadable compliance export. Admin-only (same gate every other
 * mutating/sensitive action in this app uses) — this both reads audit data
 * and writes a receipt row, so it's not a plain read like /dashboard/activity.
 * Every call inserts one compliance_exports row so an org can later prove
 * when an export was pulled and by whom, distinct from the report content
 * itself (which is always recomputed fresh from activity_log/approval_requests).
 */
export async function GET(request: NextRequest) {
  const { userId, clerkOrgId, orgSlug } = await requireOrgAdmin();
  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const periodStart = parsePeriodParam(searchParams.get("periodStart"), new Date(now.getTime() - 30 * DAY_MS));
  const periodEnd = parsePeriodParam(searchParams.get("periodEnd"), now);

  const report = await computeComplianceReport(org.id, periodStart, periodEnd);
  const rowCount = report.rows.activityLog.length + report.rows.approvalRequests.length;

  await db.insert(complianceExports).values({
    orgId: org.id,
    generatedByClerkUserId: userId,
    periodStart,
    periodEnd,
    rowCount,
    contentHash: report.contentHash,
  });

  const filename = `compliance-export-${orgSlug ?? org.id}-${now.toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
