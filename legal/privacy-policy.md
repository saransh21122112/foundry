# Foundry — Privacy Policy

**STATUS: FIRST-PASS DRAFT — NOT REVIEWED BY AN ATTORNEY. DO NOT PUBLISH,
LINK FROM THE PRODUCT, OR TREAT AS BINDING UNTIL A QUALIFIED LAWYER HAS
REVIEWED AND REVISED THIS DOCUMENT.** This was drafted by an AI assistant
from a read of the current codebase (auth, database schema, guardrail/
audit-logging code, and the one currently-implemented external-action tool)
to describe what the product actually collects and does today, not generic
boilerplate. It is a starting point for real legal review — including a
real assessment of which privacy laws apply (GDPR, CCPA, etc.) — not a
substitute for it.

Last drafted: 2026-08-02 (early/beta product, no live paying customers).

---

## 1. What we collect

**Account and organization data**, via our authentication/identity
provider, Clerk: your name, email address, and organization membership/role
information needed to log you in and know which organization's data you
can access.

**Activity log data.** This is the core of how Foundry works, not
incidental telemetry: every time an agent attempts an action — whether it's
allowed to run immediately, gets paused for your approval, or is blocked
outright — we record an entry containing:

- which organization and department the action belongs to,
- which run/session it happened in,
- what kind of event it was (attempted, allowed, blocked, executed,
  failed, etc.),
- the name of the tool the agent tried to call,
- the input given to that tool (e.g., for an email-sending action: the
  recipient, subject, and body),
- the output or result of that tool call where applicable (e.g., a
  provider-assigned email ID, or an error message if the send failed),
  and
- who or what triggered it (an agent, or a specific user via their
  account).

We keep this log because it is the audit trail behind our guardrail
system — the mechanism that enforces your configured autonomy levels,
budget caps, and the hard-coded approval rules for irreversible, financial,
or legal actions (see the Terms of Service, Section 2). It exists so that
every gated action, whatever the outcome, is traceable after the fact. This
is a safety feature we build the product around, not incidental logging we
could easily turn off.

**Task/session data.** We keep a lightweight index of your organization's
agent "runs" (task sessions) — who started a task and a short title/preview
of what it was — so your dashboard can list past and current tasks. The
full transcript of a run (the actual conversation and step-by-step agent
reasoning) is stored durably by the underlying agent runtime we build on,
not duplicated in our own database beyond that index.

**Billing data.** Payment and subscription information is handled by
Stripe; we do not store your raw payment card details ourselves.

## 2. Why we collect it

- To operate the service — running your configured agents, enforcing your
  guardrail settings, showing you your task history and dashboard.
- To maintain the audit trail described above, which is how we (and you)
  can answer "what did an agent actually do, and why was it allowed or
  blocked" after the fact — this is a safety and accountability feature,
  not analytics.
- To bill you, via Stripe, for your subscription.
- To provide customer support when you contact us about your account or
  an agent's behavior.

## 3. Who your data flows through (subprocessors)

Given Foundry's current architecture, data may pass through the following
third-party services in the course of operating the product:

- **Clerk** — authentication and organization/user management.
- **Stripe** — billing and payment processing.
- **Neon** (Postgres) — our production database, where account,
  organization, and activity-log data described above is stored.
- **Resend** — the email-sending provider used by the sales department's
  outreach-email tool. When an agent sends an email on your organization's
  behalf, the recipient address, subject, and body pass through Resend's
  systems to be delivered. [As of this draft, outbound email is sent from
  a single shared Resend sending address, not a per-organization connected
  mailbox — update this section if/when that changes.]
- **Our AI model provider(s)** — agent reasoning and any generated content
  is produced by underlying large language models, currently accessed via
  Anthropic's models through Vercel's AI Gateway. Content you or your
  agents produce or process (prompts, tool inputs/outputs, generated text)
  is sent to this provider to generate agent responses.

We do not sell your personal data to third parties, and we do not use it
for purposes unrelated to operating and improving Foundry.

**On AI model training:** we have not built any pipeline in our own code
that uses your data to train or fine-tune a model, and do not intend to.
Whether the underlying model provider(s) use API-submitted data to improve
their own models is governed by that provider's own terms, not by
anything in Foundry's code — [we have not independently audited or
confirmed this, and this section should be updated with a specific,
verified statement — e.g. a link to Anthropic's/Vercel's applicable data-
use terms — once reviewed, rather than relying on this general statement].

## 4. Data retention

**This is a known gap, stated honestly rather than glossed over:** Foundry
does not currently have an automated data retention or deletion policy.
Activity log entries, task/session records, and account data persist in
our database indefinitely unless manually deleted. We do not currently
auto-expire old activity log entries, task history, or terminated-account
data. This should be treated as a real gap to close (with a defined
retention window, particularly for the activity log's tool inputs/outputs,
which can contain content like real email addresses and message bodies)
rather than a designed feature — not something to represent to users as
already handled.

## 5. Your rights and how to exercise them

Depending on your jurisdiction, you may have rights to access, export, or
delete the personal data we hold about you or your organization.

**Current actual capability, stated honestly:** Foundry does not yet have
a self-serve "export my data" or "delete my account" button in the
product. Today, access/export/deletion requests are handled manually —
contact us at **[CONTACT EMAIL — TBD, needs a real privacy/support
contact address]** and we will fulfill the request by hand. [Once
self-serve tooling exists, update this section and stop describing it as
manual.]

Because there is no automated deletion pipeline yet (Section 4), a manual
deletion request may take longer to fully complete than it would once that
tooling exists — the activity log in particular spans multiple related
tables and was not built with a one-click purge path.

## 6. Data of people who aren't Foundry users

If your organization uses the sales-outreach email tool to email someone
outside your organization, that recipient's email address, and the content
sent to them, is processed by Foundry and Resend as described above, even
though that recipient never signed up for Foundry. Your organization is
responsible for having a lawful basis (and, where required, consent) to
email that person — see Terms of Service, Section 3 (Acceptable Use).

## 7. Security

[Describe actual security measures in place — encryption in transit/at
rest, access controls, etc. — TBD; do not assert specifics not verified
against the current implementation.]

## 8. Changes to this policy

We may update this Privacy Policy as the product develops, particularly as
retention tooling and self-serve export/delete capability (Sections 4–5)
are built out. [Describe notice mechanism — TBD, same as Terms of Service
Section 8.]

## 9. Contact

Questions about this Privacy Policy, or to make an access/export/deletion
request: **[CONTACT EMAIL — TBD, needs a real privacy/support contact
address]**.

---

### Placeholders left in this document

- `[As of this draft, outbound email is sent from a single shared Resend sending address ...]` — factual note, update if architecture changes rather than a decision needed, but flagged since it affects the accuracy of Section 3.
- `[we have not independently audited or confirmed this ...]` — model-provider training-use claim needs verification against Anthropic's/Vercel AI Gateway's actual current terms before being stated more confidently.
- `[CONTACT EMAIL — TBD, needs a real privacy/support contact address]` (appears twice — Sections 5 and 9)
- `[Describe actual security measures in place ...]` (Section 7 — currently empty, needs real input)
- `[Describe notice mechanism — TBD ...]` (Section 8)

Also not yet filled in anywhere in this document, needed before publication:
business entity legal name/type and registered address (not present at
all), and a real decision on which specific privacy laws (GDPR, CCPA/CPRA,
etc.) apply and what additional disclosures/mechanisms (e.g. a Data
Processing Addendum, a formal "Do Not Sell/Share" mechanism) they require —
this draft only describes current architecture honestly, it does not
perform that legal analysis.
