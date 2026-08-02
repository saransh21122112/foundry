import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { DEPARTMENTS, AUTONOMY_LEVELS, RISK_CLASSES } from "@foundry/shared-types";

// ---------------------------------------------------------------------------
// Shared enums — sourced from @foundry/shared-types so this schema and
// packages/guardrails' TypeScript unions can never drift apart.
// ---------------------------------------------------------------------------

/** Mirrors the 7 department subagents under apps/agent-runtime/agent/subagents/. */
export const departmentEnum = pgEnum("department", DEPARTMENTS);

export const autonomyLevelEnum = pgEnum("autonomy_level", AUTONOMY_LEVELS);

/**
 * Matches each tool wrapper's declared riskClass (see packages/guardrails).
 * `irreversible`, `financial`, and `legal` tool calls always require human
 * approval regardless of autonomy_level — enforced as a code constant in
 * packages/guardrails, never as editable data.
 */
export const riskClassEnum = pgEnum("risk_class", RISK_CLASSES);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "tool_call_attempted",
  "tool_call_allowed",
  "tool_call_blocked",
  "tool_call_executed",
  "tool_call_failed",
  "approval_granted",
  "approval_rejected",
  "kill_switch_triggered",
  "kill_switch_resolved",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "active",
  "revoked",
  "expired",
]);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

/**
 * Mirrors a Clerk Organization. Clerk is the source of truth for
 * membership/auth (see apps/agent-runtime/agent/channels/eve.ts); this table
 * exists so every other table can foreign-key against a stable org_id
 * without round-tripping to Clerk on every query.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  // What this org's company actually does — optional, filled in during
  // onboarding. Read by apps/agent-runtime/agent/lib/resolve-instructions.ts
  // to ground every agent's prompt in this org's real business instead of
  // generic "virtual AI company" boilerplate; nothing else reads these.
  description: text("description"),
  website: text("website"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  clerkOrgIdIdx: uniqueIndex("organizations_clerk_org_id_idx").on(t.clerkOrgId),
  slugIdx: uniqueIndex("organizations_slug_idx").on(t.slug),
}));

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  clerkUserId: text("clerk_user_id").notNull(),
  role: text("role").notNull().default("member"), // owner | admin | member
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgUserIdx: uniqueIndex("memberships_org_user_idx").on(t.orgId, t.clerkUserId),
}));

// ---------------------------------------------------------------------------
// Department configuration
// ---------------------------------------------------------------------------

export const departmentConfigs = pgTable("department_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  // New departments always start at the safest setting — see
  // packages/guardrails: nothing upgrades this except an explicit customer
  // action recorded through the dashboard.
  autonomyLevel: autonomyLevelEnum("autonomy_level").notNull().default("draft_only"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgDeptIdx: uniqueIndex("department_configs_org_dept_idx").on(t.orgId, t.department),
}));

/** Free-form per-department knobs that don't warrant dedicated columns. */
export const departmentSettings = pgTable("department_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
}, (t) => ({
  orgDeptKeyIdx: uniqueIndex("department_settings_org_dept_key_idx").on(
    t.orgId,
    t.department,
    t.key,
  ),
}));

// ---------------------------------------------------------------------------
// Guardrails: the data every enforce() call reads
// ---------------------------------------------------------------------------

export const budgetCaps = pgTable("budget_caps", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  // null department = whole-org cap, checked in addition to any per-department
  // cap for the same unit — mirrors kill_switches' existing null-is-org-wide
  // convention. The org-wide row is the real spend ceiling: it's the one
  // that still catches a runaway org even if a customer never configures a
  // single per-department cap (the previous default state was "uncapped").
  department: departmentEnum("department"),
  scope: text("scope").notNull(), // per_run | daily | monthly
  unit: text("unit").notNull(), // usd | api_calls | emails_sent | ...
  capAmount: numeric("cap_amount", { precision: 12, scale: 4 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
  currentSpend: numeric("current_spend", { precision: 12, scale: 4 }).notNull().default("0"),
}, (t) => ({
  orgDeptScopeUnitIdx: uniqueIndex("budget_caps_org_dept_scope_unit_idx").on(
    t.orgId,
    t.department,
    t.scope,
    t.unit,
  ),
}));

/**
 * Per-org narrowing of the default allowlist a department template ships
 * with. An org can disable a tool it doesn't want used; it can never enable
 * a tool the hard-coded riskClass rules in packages/guardrails would always
 * block regardless of allowlist state.
 */
export const toolAllowlists = pgTable("tool_allowlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  toolName: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull().default(true),
}, (t) => ({
  orgDeptToolIdx: uniqueIndex("tool_allowlists_org_dept_tool_idx").on(
    t.orgId,
    t.department,
    t.toolName,
  ),
}));

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  agentRunId: text("agent_run_id").notNull(), // eve session id
  // eve's own per-tool-call id for this approval (ApprovalContext.callId,
  // see node_modules/eve/docs/tools/human-in-the-loop.md). Not the same as
  // this row's own `id` — this is what actually resuming the parked eve
  // session needs (POST .../session/:sessionId with inputResponses keyed
  // by this value), which isn't wired up yet. Resolving this row today
  // updates our own audit record; it does not yet un-pause the agent.
  eveCallId: text("eve_call_id"),
  toolName: text("tool_name").notNull(),
  toolInput: jsonb("tool_input").notNull(),
  reason: text("reason").notNull(), // budget_exceeded | not_in_allowlist | hard_rule | autonomy_off | draft_mode
  status: approvalStatusEnum("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByClerkUserId: text("resolved_by_clerk_user_id"),
  resolutionNote: text("resolution_note"),
}, (t) => ({
  orgStatusIdx: index("approval_requests_org_status_idx").on(t.orgId, t.status),
}));

/**
 * Append-only. Every tool call the enforcement layer sees, allowed or
 * blocked, gets exactly one row here — written inside enforce() itself, not
 * left to individual tool implementations to remember. Never mutated.
 */
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  // null = an org-wide event (e.g. an org-wide kill switch trigger), same
  // null-is-org-wide convention as kill_switches.department and
  // budget_caps.department.
  department: departmentEnum("department"),
  agentRunId: text("agent_run_id").notNull(),
  eventType: activityEventTypeEnum("event_type").notNull(),
  toolName: text("tool_name"),
  toolInput: jsonb("tool_input"),
  toolOutput: jsonb("tool_output"),
  actor: text("actor").notNull(), // "agent" or a clerk user id
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgTimeIdx: index("activity_log_org_time_idx").on(t.orgId, t.timestamp),
}));

/**
 * One row per "Run a task" session, so the dashboard can list an org's
 * tasks (a session manager) instead of only ever tracking the single most
 * recent one. eve itself has no list-sessions endpoint — its own docs
 * (patterns/multi-tenant-approvals.md) say session ownership/listing is an
 * application concern, not something the runtime provides. `id` is eve's
 * own session id (e.g. `wrun_...`), not a generated uuid, so this table is
 * purely a lightweight index over sessions eve already durably owns.
 */
export const runSessions = pgTable("run_sessions", {
  id: text("id").primaryKey(), // eve session id
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
  // First ~80 chars of the task message — just enough to tell tasks apart
  // in a list, not a full transcript (that still lives in eve's own
  // history, fetched fresh when a task is opened).
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index("run_sessions_org_created_idx").on(t.orgId, t.createdAt),
}));

/**
 * Per-org override of an agent's instructions.md. `agentId` matches the id
 * scheme in apps/web/app/dashboard/prompts/agents.ts (e.g. "eng-lead",
 * "swe-lead/backend-developer") — not a foreign key to anything, since the
 * canonical agent list is defined in code, not data. No row for a given
 * (orgId, agentId) = that org still gets the shared default file content;
 * a row here is what turns the previously-shared-by-every-org prompt editor
 * into a genuinely per-tenant one.
 */
export const agentPromptOverrides = pgTable("agent_prompt_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  agentId: text("agent_id").notNull(),
  content: text("content").notNull(),
  updatedByClerkUserId: text("updated_by_clerk_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgAgentIdx: uniqueIndex("agent_prompt_overrides_org_agent_idx").on(t.orgId, t.agentId),
}));

// ---------------------------------------------------------------------------
// Integrations & kill switch
// ---------------------------------------------------------------------------

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(), // gmail | slack | github | twitter | webhook | ...
  // Opaque pointer into Vercel Connect's own token storage. The raw OAuth
  // token never lives in this table. Nullable: provider="webhook" (see
  // `config` below) has no token at all, and no OAuth provider is wired up
  // yet either.
  connectTokenRef: text("connect_token_ref"),
  // Provider-specific, non-secret config that isn't a token — e.g.
  // provider="webhook" stores `{ url: string }` here (a customer-owned
  // Slack/Discord/Zapier incoming-webhook URL, not something we consider
  // a credential in the same sense as an OAuth token).
  config: jsonb("config"),
  scopes: jsonb("scopes").notNull().default("[]"),
  connectedByClerkUserId: text("connected_by_clerk_user_id").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  status: integrationStatusEnum("status").notNull().default("active"),
}, (t) => ({
  orgProviderIdx: uniqueIndex("integrations_org_provider_idx").on(t.orgId, t.provider),
}));

export const killSwitches = pgTable("kill_switches", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  // null department = whole-org kill
  department: departmentEnum("department"),
  active: boolean("active").notNull().default(true),
  triggeredByClerkUserId: text("triggered_by_clerk_user_id").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
}, (t) => ({
  orgDeptActiveIdx: index("kill_switches_org_dept_active_idx").on(
    t.orgId,
    t.department,
    t.active,
  ),
}));
