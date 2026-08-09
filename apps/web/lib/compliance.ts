import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { activityLog, approvalRequests, db } from "@foundry/db";
import { KNOWN_TOOLS, type Department, type RiskClass } from "@foundry/shared-types";

/** riskClasses that always require prior human approval — see
 * HARD_RULE_RISK_CLASSES in packages/guardrails/src/enforce.ts. Duplicated
 * here rather than imported for the same reason deps-db.ts duplicates
 * APPROVAL_REASON_LABEL: apps/web depends on guardrails, not the reverse,
 * and this is a small enough constant to keep in sync by inspection. */
const HARD_RISK_CLASSES = new Set<RiskClass>(["irreversible", "financial", "legal"]);

/** department -> toolName -> riskClass, built once from the hand-maintained
 * KNOWN_TOOLS registry (packages/shared-types). */
const TOOL_RISK_CLASS: Record<string, RiskClass> = {};
for (const [department, tools] of Object.entries(KNOWN_TOOLS) as Array<[Department, typeof KNOWN_TOOLS[Department]]>) {
  for (const tool of tools) {
    TOOL_RISK_CLASS[`${department}:${tool.name}`] = tool.riskClass;
  }
}

export interface ExecutionRow {
  id: string;
  department: string;
  toolName: string;
  agentRunId: string;
  riskClass: RiskClass;
  timestamp: Date;
}

export interface ApprovalRow {
  id: string;
  department: string;
  toolName: string;
  agentRunId: string;
  status: "approved" | "rejected";
  reason: string;
  resolvedAt: Date;
}

export interface ClaimAResult {
  total: number;
  matched: number;
  violations: ExecutionRow[];
}

export interface ClaimBResult {
  totalRejected: number;
  correctlyBlocked: number;
  violations: ApprovalRow[];
}

/** Groups two lists of rows by the tightest correlation key both tables
 * share: department + toolName + agentRunId. Neither table has a per-call
 * id linking one specific execution to one specific approval, so this is
 * as tight as the pairing can get. */
function correlationKey(row: { department: string; toolName: string; agentRunId: string }): string {
  return `${row.department}:${row.toolName}:${row.agentRunId}`;
}

/**
 * Pure reconciliation logic, deliberately separated from computeComplianceReport
 * so it's testable without a database (see compliance.test.ts).
 *
 * Claim A — every hard-risk execution had prior approval: within each
 * correlation group, sort executions and approved-approvals by time, then
 * greedily pair each execution with the earliest not-yet-consumed approved
 * approval whose resolvedAt precedes the execution's timestamp. Unpaired
 * executions are violations.
 *
 * Claim B — every rejected hard-risk attempt was honored: for each rejected
 * approval whose reason is a hard-rule reason, confirm no execution exists
 * in the same correlation group at or after that rejection's resolvedAt.
 */
export function reconcileClaims(executions: ExecutionRow[], approvals: ApprovalRow[]): { claimA: ClaimAResult; claimB: ClaimBResult } {
  const approvedByKey = new Map<string, ApprovalRow[]>();
  for (const a of approvals) {
    if (a.status !== "approved") continue;
    const key = correlationKey(a);
    const list = approvedByKey.get(key) ?? [];
    list.push(a);
    approvedByKey.set(key, list);
  }
  for (const list of approvedByKey.values()) {
    list.sort((x, y) => x.resolvedAt.getTime() - y.resolvedAt.getTime());
  }

  const executionsByKey = new Map<string, ExecutionRow[]>();
  for (const e of executions) {
    const key = correlationKey(e);
    const list = executionsByKey.get(key) ?? [];
    list.push(e);
    executionsByKey.set(key, list);
  }

  const violationsA: ExecutionRow[] = [];
  let matched = 0;
  for (const [key, execs] of executionsByKey) {
    const approvedList = approvedByKey.get(key) ?? [];
    let cursor = 0;
    const sortedExecs = [...execs].sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    for (const exec of sortedExecs) {
      // approvedList is sorted ascending; execs are processed ascending too,
      // so if the next unconsumed approval doesn't precede this execution it
      // can't have covered any earlier (already-processed) execution either.
      const candidate = approvedList[cursor];
      if (candidate && candidate.resolvedAt.getTime() <= exec.timestamp.getTime()) {
        cursor += 1;
        matched += 1;
      } else {
        violationsA.push(exec);
      }
    }
  }

  const rejectedHardRule = approvals.filter((a) => a.status === "rejected" && a.reason.startsWith("hard_rule:"));
  const violationsB: ApprovalRow[] = [];
  for (const rejection of rejectedHardRule) {
    const key = correlationKey(rejection);
    const laterExecution = (executionsByKey.get(key) ?? []).some(
      (exec) => exec.timestamp.getTime() >= rejection.resolvedAt.getTime(),
    );
    if (laterExecution) violationsB.push(rejection);
  }

  return {
    claimA: { total: executions.length, matched, violations: violationsA },
    claimB: {
      totalRejected: rejectedHardRule.length,
      correctlyBlocked: rejectedHardRule.length - violationsB.length,
      violations: violationsB,
    },
  };
}

export interface ComplianceReport {
  rows: { activityLog: ExecutionRow[]; approvalRequests: ApprovalRow[] };
  claimA: ClaimAResult;
  claimB: ClaimBResult;
  contentHash: string;
  periodStart: Date;
  periodEnd: Date;
}

/** SHA-256 over the canonical (stably-ordered, stably-keyed) JSON of the
 * included rows — cheap tamper-evidence, not cryptographic signing. Only a
 * legitimate story because activity_log is genuinely append-only (see
 * packages/db/src/schema.ts's comment on that table): nothing in this repo
 * ever updates or deletes a row there. */
function computeContentHash(executions: ExecutionRow[], approvals: ApprovalRow[]): string {
  const canonical = JSON.stringify({
    activityLog: executions
      .map((e) => ({ ...e, timestamp: e.timestamp.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    approvalRequests: approvals
      .map((a) => ({ ...a, resolvedAt: a.resolvedAt.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Builds the full compliance report for one org/period. The flagship claim:
 * every irreversible/financial/legal action this org's agents took had
 * prior human sign-off (claim A), and every rejected attempt at one was
 * actually honored (claim B). Today every real tool in the repo is
 * reversible-low/reversible-high (see KNOWN_TOOLS), so claimA/claimB will
 * legitimately report zero hard-risk rows — that's the true state, not a
 * placeholder, and this query starts proving something real the moment an
 * irreversible/financial/legal tool is added.
 */
export async function computeComplianceReport(orgId: string, periodStart: Date, periodEnd: Date): Promise<ComplianceReport> {
  const executedRows = await db
    .select({
      id: activityLog.id,
      department: activityLog.department,
      toolName: activityLog.toolName,
      agentRunId: activityLog.agentRunId,
      timestamp: activityLog.timestamp,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.orgId, orgId),
        eq(activityLog.eventType, "tool_call_executed"),
        gte(activityLog.timestamp, periodStart),
        lte(activityLog.timestamp, periodEnd),
      ),
    );

  const executions: ExecutionRow[] = executedRows
    .filter((r): r is typeof r & { department: string; toolName: string } => !!r.department && !!r.toolName)
    .map((r) => ({
      id: r.id,
      department: r.department,
      toolName: r.toolName,
      agentRunId: r.agentRunId,
      timestamp: r.timestamp,
      riskClass: TOOL_RISK_CLASS[`${r.department}:${r.toolName}`],
    }))
    .filter((r) => !!r.riskClass && HARD_RISK_CLASSES.has(r.riskClass)) as ExecutionRow[];

  const approvalRows = await db
    .select({
      id: approvalRequests.id,
      department: approvalRequests.department,
      toolName: approvalRequests.toolName,
      agentRunId: approvalRequests.agentRunId,
      status: approvalRequests.status,
      reason: approvalRequests.reason,
      resolvedAt: approvalRequests.resolvedAt,
    })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, orgId),
        inArray(approvalRequests.status, ["approved", "rejected"]),
        gte(approvalRequests.resolvedAt, periodStart),
        lte(approvalRequests.resolvedAt, periodEnd),
      ),
    );

  const approvals: ApprovalRow[] = approvalRows
    .filter((r): r is typeof r & { resolvedAt: Date; status: "approved" | "rejected" } => !!r.resolvedAt && (r.status === "approved" || r.status === "rejected"))
    .map((r) => ({
      id: r.id,
      department: r.department,
      toolName: r.toolName,
      agentRunId: r.agentRunId,
      status: r.status,
      reason: r.reason,
      resolvedAt: r.resolvedAt,
    }));

  const { claimA, claimB } = reconcileClaims(executions, approvals);

  return {
    rows: { activityLog: executions, approvalRequests: approvals },
    claimA,
    claimB,
    contentHash: computeContentHash(executions, approvals),
    periodStart,
    periodEnd,
  };
}
