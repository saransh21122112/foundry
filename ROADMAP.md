# Foundry roadmap

Foundry turns Saransh's personal `ai-company` Claude Code plugin into a
commercial, multi-tenant SaaS: solo founders sign up, get their own virtual
AI company (7 departments), and department agents run server-side, taking
real autonomous actions within guardrails — not just draft-only output a
human has to approve every single time.

Full architecture reasoning lives in the Phase 0 planning session; this file
tracks what's built and what's left, phase by phase, so a future session
doesn't have to re-derive the design.

## Direction change (2026-08-11): self-hosted per-org, not central multi-tenant SaaS

**Before:** Foundry was one centrally-operated multi-tenant SaaS — Saransh's
infrastructure, every signed-up org sharing it as tenants isolated by the
`organizations` table/Clerk org scoping/`packages/guardrails`.

**Now:** Foundry is a self-hosted product each organization deploys into its
own AWS account — same distribution model as OpenClaw. An org clones/runs
the repo and stands up its own stack via CDK rather than signing up for
Saransh-hosted infrastructure.

**Why:** this resolves the cross-tenant risk that made direct/non-sandboxed
host execution unsafe to offer on a shared deployment. A genuinely
single-tenant deployment (one org, one AWS account, one stack) doesn't have
that risk. This session built the mechanism for it:
`infra/lib/foundry-stack.ts`'s `orgName` CDK context parameterization
(independent per-org stacks, synth-verified for no naming collisions), and
`exec_host.ts`, a direct/non-sandboxed execution tool gated behind
`ALLOW_HOST_EXEC`, designed specifically for this self-hosted single-tenant
model. README.md/DEPLOY.md/ARCHITECTURE.md are being rewritten separately to
reflect this.

## Running eve dev locally (gotchas found 2026-07-29)

- Needs `AI_GATEWAY_API_KEY` in `apps/agent-runtime/.env` (Vercel AI
  Gateway) — and Vercel requires a credit card on file before it'll serve
  *any* request, even free-tier credits. That's a real payment step; ask
  before assuming it's set up.
- `eve dev` silently reconnects to a previous run via
  `apps/agent-runtime/.eve/dev-server-state.v1.json` rather than always
  starting fresh, even after killing the process — delete that file (or
  pass an explicit `--port`) if a restart doesn't seem to take effect.
- `apps/web/.env.local` needs `AGENT_RUNTIME_URL` pointed at whatever port
  `eve dev` actually prints.

## Phase 0 — Foundation/scaffold (done)

- npm-workspaces + turborepo monorepo at `~/Projects/foundry/`.
- **Runtime decision: eve, not a hand-rolled Workflow DevKit loop.**
  Confirmed by reading eve's actual docs (not just its skill description):
  eve ships a native, per-tool `approval` policy (`always()`/`once()`/
  `never()`/custom function) with durable pause/resume, receives full
  session/tenant context, and is itself built on Vercel Workflow DevKit
  under the hood. Tools execute as code we write in our own app runtime —
  not inside an opaque framework loop — so there's no "did the framework
  bypass our check" risk. `apps/agent-runtime` is a real eve project;
  `packages/guardrails`'s `enforce()` pipeline is wired in as that
  `approval` policy via `makeApprovalPolicy()`.
- `apps/agent-runtime` — eve project. Root orchestrator
  (`agent/instructions.md`) delegates to 7 declared subagents under
  `agent/subagents/<dept>/`, one per department (`eng-lead`, `product-lead`,
  `researcher`, `ops-manager`, `design-lead`, `data-lead`, `sales-lead`),
  each with instructions ported from the original Claude Code plugin at
  `~/vs code/claude_code_ai_company/plugins/ai-company/agents/*.md` — kept
  the "how this department thinks" content, dropped anything assuming
  Claude Code's own permission prompts or the personal Obsidian vault, and
  turned informal "always check with the user" caveats into either explicit
  prose about the guardrail layer or (for product-lead's priority-ranking
  rule) an actual hard-coded rule.
- `apps/agent-runtime/agent/subagents/sales-lead/tools/send_email.ts` — the
  one reference tool built so far, showing the full pattern every gated
  tool should follow: declare `riskClass`, wire `approval` to
  `makeApprovalPolicy()`, only touch a real provider once eve resolves the
  policy. Not wired to a real provider yet (throws) — that's Phase 2.
- `packages/db` — Drizzle schema for all 10 tables (organizations,
  memberships, department_configs, department_settings, budget_caps,
  tool_allowlists, approval_requests, activity_log, integrations,
  kill_switches). Typechecks and generates a migration
  (`packages/db/migrations/0000_*.sql`) with no live database. Real Neon
  connection is Phase 1 (needs `DATABASE_URL`, not set anywhere yet).
- `packages/guardrails` — `enforce()`, the single chokepoint every gated
  tool call passes through: kill switch → autonomy level → hard-coded
  always-approve risk classes (`irreversible`/`financial`/`legal`, not
  customer-configurable) → budget cap → tool allowlist → rate limit →
  execute. 10 unit tests, all passing, against in-memory fakes — zero DB or
  LLM dependency to verify the logic. `deps-db.ts` is the real Postgres
  implementation, typechecked but not yet exercised against a live DB.
  `eve-adapter.ts` bridges `enforce()`'s result into eve's `approval`
  return shape.
- `apps/web` — Next.js app, builds successfully (`npm run build` in
  `apps/web`). Two pages: a marketing-page placeholder and
  `/dashboard/approvals` (queries `approval_requests` for real, but has no
  org-scoping yet since Clerk isn't wired up — **do not ship this page
  as-is**, it currently has no tenant isolation).
- Everything above passes `npm install && npm run build` at the repo root
  via turborepo, and `packages/guardrails`'s tests pass via `npm test` in
  that package.

### Known loose ends

All fixed as of 2026-07-29 — see Phase 1 below for the node-engine and
`shared-types` fixes. The nested `code-reviewer` sub-sub-agent (the
original plugin had one, read-only by construction) now exists at
`apps/agent-runtime/agent/subagents/eng-lead/subagents/code-reviewer/` —
no `tools/`/`connections/` of its own, so nothing there can write anywhere
yet; `eng-lead`'s own instructions were updated to delegate pure-review
requests to it. `eve build` confirmed the nested subagent compiles.

## Phase 1 — Core agent runtime + guardrail layer (next, multi-session)

- ~~Provision Neon Postgres~~ **Done (2026-07-29).** Real Neon project,
  `DATABASE_URL` set in `packages/db/.env`, `apps/web/.env.local`,
  `apps/agent-runtime/.env` (all gitignored, never committed). Migration
  applied for real (`npx drizzle-kit migrate` from `packages/db`) — all 10
  tables confirmed live. `deps-db.ts` is still only typechecked, not yet
  exercised (that happens once a real tool call runs through `enforce()`
  end-to-end, Phase 1 next step) — but the raw insert/select/delete path
  through the Drizzle client it uses was verified working against the live
  DB.
- ~~Wire Clerk~~ **Done (2026-07-29).** Real Clerk app (`foundry`), keys in
  `apps/web/.env.local` and `apps/agent-runtime/.env` (gitignored).
  `apps/web` has `middleware.ts` (`clerkMiddleware()`), `<ClerkProvider>` in
  the root layout, and a homepage that actually signs in/out and switches
  orgs (`useUser`, `SignInButton`/`SignUpButton`/`UserButton`/
  `OrganizationSwitcher` — note this Clerk version dropped the old
  `SignedIn`/`SignedOut` components, uses hooks instead).
  `apps/agent-runtime/agent/channels/eve.ts`'s `clerkOrgSession()` is a real
  implementation now, not a stub: verifies the request's Bearer JWT via
  `@clerk/backend`'s `verifyToken()` against `CLERK_SECRET_KEY`, and maps
  the token's `org_id` claim to `attributes.orgId`. No org on the token (or
  no/invalid token) falls through to the next auth entry rather than
  guessing. `apps/web/app/dashboard/approvals/page.tsx` now scopes its
  query through `auth()` → Clerk `orgId` → our `organizations` row (by
  `clerkOrgId`) → `approvalRequests` — no more cross-tenant reads. Org
  provisioning itself is lazy (see the `ensureOrganization()` bugfix
  entry below), not webhook-based — no "no matching row yet" dead end.
- `eve build` confirmed the whole agent graph (root + 7 subagents +
  `send_email` tool + the new `@clerk/backend` import) still compiles
  clean after this wiring.
- ~~Port 2–3 more real tools~~ **Done (2026-07-29).**
  `researcher/tools/publish_research.ts` (side-effecting, `reversible-high`,
  same gated-but-not-connected-yet shape as `send_email`) and
  `data-lead/tools/get_activity_summary.ts` — the first tool that's
  actually fully wired end-to-end, not a stub: `reversible-low`, no
  `approval` field at all (enforce()'s own logic skips human approval for
  that riskClass regardless of autonomy level), and really queries
  `activity_log` scoped by `ctx.session.auth.current.attributes.orgId`.
  `eve build` confirmed the whole graph (9 tools across 3 departments now)
  still compiles clean.
- Design real per-action cost estimation (the `estimatedCost` field on
  `ToolCall`) per integration — `enforce()`'s budget-cap step is only as
  good as the cost numbers tools report. Still open.
- ~~Real per-department/per-tool rate limiting~~ **Done (2026-07-29).**
  `deps-db.ts`'s `checkRateLimit` now counts `activity_log` rows in a
  rolling window (default 20 calls/60min, overridable per org via a
  `department_settings` row keyed `rate_limit:<toolName>`). Verified
  against the live DB: correctly allows under the limit, blocks at it, and
  doesn't leak across different tools.
- **Fixed a real bug found during this pass**: `clerkOrgSession()` was
  putting the raw Clerk `org_id` claim (`org_xxx`) into
  `attributes.orgId`, but every guardrails table foreign-keys against our
  internal `organizations.id` (uuid) — those never matched, so any real
  tool call would have silently queried against a tenant that doesn't
  exist. Fixed via `packages/db/src/orgs.ts`'s `ensureOrganization()`,
  called from both `clerkOrgSession()` and the approvals dashboard — also
  incidentally closes the "no org row yet" gap from the previous session,
  since it lazily creates the row on first sight of a Clerk org rather
  than needing a separate provisioning webhook. Verified against the live
  DB: first call creates, second call is idempotent, no duplicate rows.
- ~~`packages/shared-types` duplication~~ **Done (2026-07-29).**
  `Department`/`AutonomyLevel`/`RiskClass` now live once in
  `packages/shared-types`, imported by both `packages/db` (as the
  Postgres enum value arrays) and `packages/guardrails` (as the
  TypeScript union types) — `drizzle-kit generate` confirmed this was a
  pure refactor (`No schema changes, nothing to migrate`).
- ~~Node engine mismatch~~ **Fixed (2026-07-29).** Loosened
  `apps/agent-runtime`'s `engines.node` from the exact `24.x` to `>=24` —
  everything already built/ran fine on this machine's Node 26, the pin was
  just overly strict. `EBADENGINE` warning confirmed gone after reinstall.

## Phase 2 — Integrations (after Phase 1's pattern is proven)

- ~~Wire `send_email.ts` to a real provider~~ **Done (2026-08-01), verified
  live end-to-end.** Provider: Resend (Saransh's choice — free tier, 3K
  emails/month, no card required). `RESEND_API_KEY` in `apps/agent-runtime/
  .env`. Sends from Resend's shared test domain (`onboarding@resend.dev`)
  — a real sending domain is Phase 3/4 polish, not needed to function.
  This is a single shared platform-level account, not a per-org Vercel
  Connect connection (every org's sales-lead currently sends through the
  same Resend account) — real per-tenant sending identity is still open,
  see below.
  Verified live twice: once through the full gated path (`draft_only` →
  paused → dashboard-style approve → real send), once through
  `bounded_autonomous` (no pause, immediate send) — both produced a real
  Resend delivery id. Also closed a real gap found while wiring this: no
  tool's `execute()` was logging its actual outcome to `activity_log`
  before this (`enforce()` only logs the attempt/allow/block decision, not
  what happened after) — `send_email` now logs real
  `tool_call_executed`/`tool_call_failed` with the Resend id or error.
  This same logging pattern should be added to every other tool as it
  gets wired to a real provider, not just this one.
- Still open — **needs Saransh**: which social platform, which deploy
  target for the remaining departments' first real integrations. Per-org
  sending identity (so each customer's emails come from their own
  domain/account, not a shared Foundry-wide one) is real product work too,
  not done here.
- Port remaining department tool surfaces once the pattern is proven.

## Phase 3 — Customer dashboard (can start once Phase 1's data model is stable)

- ~~"Run a task" — the actual front door~~ **Done (2026-08-01), verified
  live end-to-end through the real product, not test scripts.** Until
  now there was no way for a customer to actually give their AI company
  something to do — every verification in this file used a temporary API
  route built and deleted each session. `apps/web/app/dashboard/run` is
  the real, permanent version: a textarea that starts a real eve session
  (`./actions.ts`'s `startTask()`) and streams the result live via
  `apps/web/app/api/agent-stream/[sessionId]/route.ts`, which proxies
  eve's own `ReadableStream` straight through (true passthrough, not
  buffered — a buffered version of this same proxy was used repeatedly
  during Phase 1 testing and worked, but only ever gave an all-at-once
  result). Shows delegation as it happens ("Delegating to sales-lead…"),
  and a paused-for-approval state with a direct link to the Approval
  queue. Verified live: submitted a real `send_email` request, watched it
  delegate and pause in the transcript, approved it from the Approval
  queue, and confirmed in Activity the full real cycle — `tried to run →
  stopped, waiting on you → tried to run → ran successfully` — happened
  for real, through the actual dashboard pages a customer would use, not
  a script standing in for one.
- **Fixed a real bug found while explaining it**: the Departments page's
  "Enabled" checkbox did nothing — stored in `department_configs` but
  never read anywhere in `enforce()`. Added `isDepartmentEnabled()` as a
  real gate (checked right after the kill switch, before autonomy level),
  covered by a new test. A department with no config row at all now
  defaults to disabled, not just `draft_only` — safer than before.
- **Full UI copy pass (2026-08-01)**: every page had raw enum values and
  jargon with no explanation (`draft_only`, `hard_rule:financial`,
  `reversible-low`, `tool_call_executed`, etc.) — Saransh couldn't tell
  what anything meant. `apps/web/lib/copy.ts` centralizes plain-English
  labels/descriptions for autonomy levels, approval reasons, risk
  classes, and activity event types; Departments now shows autonomy as
  three described radio options instead of a bare dropdown; every nav
  item (sidebar + homepage) has a one-line description.
- ~~Department config UI~~ **Done (2026-07-29), including budget caps and
  tool allowlist.** `apps/web/app/dashboard/departments` (enabled +
  autonomy level), `.../budgets` (per-department budget_caps, with a
  manual "reset spend" button since there's no automatic period rollover
  yet — real gap, flagged on the page itself, not hidden), and `.../tools`
  (allow/deny per gated tool, sourced from `@foundry/shared-types`'
  `KNOWN_TOOLS` registry). All three verified against the live DB:
  department config insert-then-update doesn't duplicate rows; budget cap
  upsert/reset works and preserves `currentSpend` correctly across a cap
  change; the allowlist toggle was verified to actually change `enforce()`'s
  real verdict (allow → deny → allow), not just write a row nobody reads.
  **All four mutating dashboard actions (approve/reject, department
  config, budget caps, allowlist) now require Clerk's `org:admin` role**
  (`apps/web/lib/authz.ts`) — a real gap found and fixed this pass: any
  signed-in org member could previously approve spend or flip a department
  to `bounded_autonomous`.
- **Fixed a second real gap found while building the allowlist UI**:
  `data-lead`'s `get_activity_summary` tool has no `approval` field (by
  design, `reversible-low` tools skip human approval) — but that also
  meant it skipped `enforce()`'s kill-switch check entirely. A paused
  department should stop reads too, not just gated actions. Added
  `packages/guardrails`'s `assertNotKilled()` for exactly this case
  (tools with no `approval` field to call explicitly), verified against
  the live DB: no-op when no kill switch is active, throws when one is.
- ~~Real approval queue UI~~ **Done (2026-07-29), including the actual
  eve session resume — verified end-to-end against a real running eve dev
  instance, a real Clerk-authenticated session, and a real gated
  `send_email` call.** `apps/web/app/dashboard/approvals`'s Approve/Reject
  buttons now really resume the parked agent, not just our own audit row.
  `apps/web/lib/eve-client.ts` is the resume client; getting it right
  required finding and fixing three real bugs that no amount of doc-reading
  alone would have surfaced, each confirmed live:
  1. **Stream reads hang forever.** `GET .../stream` never closes its HTTP
     connection on its own, even for a bounded "catch-up" read
     (`includeTailIndex=1`) — the docs' "read until it passes that tail,
     then disconnect" means the *client* must stop reading. The original
     `await res.text()` waited for a close that never comes. Fixed by
     reading the body incrementally via a stream reader and cancelling it
     once caught up to `x-eve-stream-tail-index`.
  2. **Wrong Clerk claim shape.** This Clerk instance issues `v: 2` tokens,
     where org info lives under `claims.o.{id,slg,rol}` — the flat
     `org_id`/`org_slug`/`org_role` fields `clerkOrgSession()` read are
     typed `never` on that token version. Every gated call was silently
     denied with `no_org_on_session` until this was found (via a live test
     that surfaced the exact bug) and fixed to handle both token versions.
  3. **Subagent-delegated approvals need the structured response form.** A
     tool called through a declared subagent (e.g. `sales-lead`) is
     proxied: only the ROOT session gets a `session.waiting`/
     `continuationToken` (the child never does), and answering with plain
     "approve" text — which the docs describe as generally valid — does
     **not** propagate down through the proxy. Only the structured
     `inputResponses: [{requestId, optionId}]` form actually resumes a
     proxied child. Confirmed by watching the child session go from stuck
     forever (plain text) to a genuine second turn reaching
     `session.completed` (structured form).
  `approvalRequests.eveCallId` and the parent-vs-child session id
  distinction (`session.parent.rootSessionId`, added to
  `packages/guardrails/src/eve-adapter.ts`'s `EveApprovalContext`) were
  both necessary pieces of this fix, not just nice-to-haves.
- ~~Activity/audit log viewer~~ **Done (2026-07-29).**
  `apps/web/app/dashboard/activity` — last 200 `activity_log` rows for the
  org, newest first.
- **Fixed real gap (2026-08-01)**: the homepage never linked to any of the
  5 dashboard pages above — after signing in there was nothing to click,
  which is exactly what made the whole app look broken/empty. Added a nav
  list on `/` when signed in, plus a shared `apps/web/app/dashboard/
  layout.tsx` nav bar so every dashboard page can reach every other one.
- ~~Real design pass~~ **Done (2026-08-01).** Every page was plain
  unstyled HTML until now (deliberately deferred, but Saransh expected
  more given the number of working features). Design system in
  `apps/web/app/globals.css`: dark industrial "control room" palette
  (oxidized-steel background, molten-amber primary accent), Space
  Grotesk/Inter/IBM Plex Mono via `next/font/google`. Signature element:
  `apps/web/components/AutonomyGauge.tsx`, a 3-segment heat readout that
  directly visualizes a department's `autonomy_level` (off = cold blue,
  draft_only = amber, bounded_autonomous = hot red with glow) — it's the
  literal enforce() gate rendered as UI, not decoration, and it's the
  reason the "Foundry" name became the design brief instead of a generic
  dark-mode dashboard. Mobile breakpoint added (`@media (max-width:
  720px)`, stacked rail + card-style tables) but not visually verified —
  the browser resize tool available in this environment didn't actually
  change the rendered viewport, so take a manual look before trusting it.
- Integration connection management (Connect OAuth flows) — still open,
  blocked on Phase 2's integration choice.

## Phase 4 — Launch prep

- ~~Stripe billing~~ **Account + client wiring done (2026-07-29), plan
  design not started.** Real test-mode Stripe account, keys in
  `apps/web/.env.local` (test-mode only — no live business/banking
  details submitted, so no real charge can succeed yet). `apps/web/lib/
  stripe.ts` is a real client (verified: `stripe.balance.retrieve()`
  actually authenticates against the account). `apps/web/app/api/
  webhooks/stripe/route.ts` has real signature-verification logic but
  can't run yet — `STRIPE_WEBHOOK_SECRET` doesn't exist until a webhook
  endpoint is registered against a reachable URL (needs a real deployment
  or an `stripe listen` tunnel). Still fully open: plan tiers, pricing,
  and — the part that actually matters — the mapping from a
  subscription event to `department_configs`/`budget_caps` changes (e.g.
  should a cancelled subscription force `autonomy_level` back to
  `draft_only` rather than leave `bounded_autonomous` running unpaid?).
  That's a product decision, not written yet — **needs Saransh**.
- Onboarding flow. Every new org/department should default to
  `autonomy_level: draft_only` (already the schema default) — don't let a
  first-run flow talk a customer into `bounded_autonomous` before they've
  seen the product work.
- Security review pass specifically on `packages/guardrails` — this is the
  whole safety story for the product, worth an external review before real
  customer integrations go live.
- Platform-level rate limiting/abuse prevention (Vercel Firewall).
- Skills marketplace — designed in full in
  [`SKILLS_MARKETPLACE.md`](./SKILLS_MARKETPLACE.md), not built yet. Browse/
  install reusable per-department skills (eve's native `Skill` primitive),
  copy-on-install, org-scoped.

## Open decisions only Saransh can make (don't guess these)

1. Product name (currently the placeholder slug `foundry` throughout).
2. Which integration ships first per department (Phase 2).
3. Pricing model specifics (Phase 4).
4. Legal/compliance scope — audit log retention, data residency, any
   regulatory obligations for departments taking real-world actions
   (`eng-lead` deploying code, `sales-lead` sending email).
5. **Whether to keep or remove Stripe billing** (2026-08-11, following the
   self-hosted direction change above): `apps/web/lib/stripe.ts`,
   `/dashboard/billing`, `apps/web/app/api/webhooks/stripe/route.ts`, and
   the `STRIPE_*` env vars. Billing stops making obvious product sense once
   orgs run and pay for their own infrastructure directly — nobody is
   subscribing to Saransh for infra they themselves operate. This is a
   business call, not inferred or acted on here — the Stripe code is
   untouched, this is only a flagged open decision.
