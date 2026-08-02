# Foundry — Terms of Service

**STATUS: FIRST-PASS DRAFT — NOT REVIEWED BY AN ATTORNEY. DO NOT PUBLISH,
LINK FROM THE PRODUCT, OR TREAT AS BINDING UNTIL A QUALIFIED LAWYER HAS
REVIEWED AND REVISED THIS DOCUMENT.** This was drafted by an AI assistant
from a read of the current codebase to describe what the product actually
does today. It is a starting point for real legal review, not a substitute
for it. Every bracketed `[...]` placeholder below needs a real answer before
this document is usable.

Last drafted: 2026-08-02 (early/beta product, no live paying customers,
Stripe billing in test mode only).

---

## 1. What Foundry is

Foundry is a platform that lets an organization ("you," "your organization,"
"Customer") configure a set of AI agents, organized into departments
(engineering, product, research, operations, design, data, sales, and
others as offered), to do work on the organization's behalf. Depending on
how you configure them, these agents can:

- Draft content and recommendations for a human to review, or
- Take real, autonomous actions with real-world effects — for example,
  sending outreach email through a connected email provider, writing files,
  or running code in an isolated sandboxed environment — without a human
  approving each individual action first.

**Foundry is not a guarantee of correctness.** Output from any department
agent — including but not limited to written content, code, data analysis,
or business recommendations — may be wrong, incomplete, or unsuitable for
your purposes. Foundry does not provide financial, legal, medical,
accounting, or other professional advice, and no agent's output should be
treated as such. You are responsible for reviewing and validating agent
output, especially anything you rely on for a business, financial, or
legal decision.

## 2. Autonomy levels and your responsibility for configured actions

Foundry gives each organization control, per department, over:

- **Autonomy level** — how much an agent can do without a human approving
  each action first (e.g., off, drafts-only, or fully autonomous within
  the constraints below).
- **Budget/spend caps** — limits on cost-incurring actions per department.
- **A tool allowlist and rate limits** for what each department's agents
  may call.

Foundry enforces a chokepoint (our "guardrail" system) that checks every
attempted agent action against your configuration before it runs. Certain
categories of action — those we classify as irreversible, financial, or
legal in nature — always require your explicit human approval, regardless
of how permissive your autonomy settings are; this ceiling is not something
your configuration can override or widen. Every attempted action, whether
allowed, blocked, or paused for approval, is recorded in an audit log (see
the Privacy Policy for what that log contains and how long it's kept).

**You are responsible for the autonomy level and budget caps you set.** If
you configure a department as fully autonomous, you are authorizing agents
in that department to take the actions your configuration permits —
including, for example, sending real emails to real recipients through the
sales department's email tool — without a further approval step from you.
Foundry enforces what you configured; the decision to grant that autonomy
is yours. If an agent takes an action within the bounds of your own
configuration that you did not want taken, that is a consequence of your
configuration choice, not a platform malfunction — though we want to know
about it either way (see Section 7).

This also means: review your autonomy and budget settings before turning
them on, keep credentials/API keys for any connected third-party service
(e.g., an email-sending account) scoped appropriately, and treat "fully
autonomous" as exactly that.

## 3. Acceptable use

You agree not to use Foundry, or configure any Foundry agent, to:

- Generate or distribute illegal content, or content that infringes a
  third party's intellectual property or other rights.
- Send spam, unsolicited bulk email, phishing content, or harassing
  communications through the sales department's email-sending tool or any
  other outbound-communication capability, or otherwise violate applicable
  anti-spam law (e.g., CAN-SPAM, CASL, or similar) or the acceptable-use
  policies of the underlying providers (e.g., our email-sending provider,
  our AI model provider).
- Attempt to circumvent, disable, or exceed the guardrail/approval system
  described in Section 2.
- Use the code-execution/sandbox capability to attack, scan, or gain
  unauthorized access to systems you do not own or have permission to
  test, or to run malware or other harmful code.
- Use Foundry to build a competing product by systematically extracting
  our platform's own prompts, guardrail logic, or non-public product
  design.

We may suspend or terminate access for a violation of this section (see
Section 6).

## 4. Service provided "as-is" — early/beta stage

Foundry is an early-stage product. Unless we've entered into a separate
written agreement with you that says otherwise:

- The service is provided "as is" and "as available," without warranties
  of any kind, express or implied, including merchantability, fitness for
  a particular purpose, and non-infringement.
- We do not currently offer an uptime service-level agreement (SLA).
- Features, department availability, pricing, and the specific tools
  available to each department agent may change, including in
  backward-incompatible ways, as the product develops.
- Third-party services Foundry depends on (our AI model provider, email
  provider, database provider, authentication provider, payment
  processor) have their own availability and may themselves experience
  outages or changes outside our control.

## 5. Billing and subscriptions

Foundry is billed through Stripe. [As of this draft, billing runs in
Stripe test mode only — no live charges are being collected. This section
is written to apply once live billing goes live; it should be reviewed
again at that time.]

- You authorize us to charge your payment method on file, via Stripe, for
  the subscription plan and any usage-based or add-on charges associated
  with your account, per the pricing then in effect on our pricing page or
  order form.
- Prices, plans, and billing periods may change; we will provide reasonable
  advance notice of changes that affect your then-current plan.
- [Refund policy: TBD — needs a real decision, e.g. no refunds for partial
  billing periods vs. pro-rated refunds, before this goes live.]
- [Cancellation terms: TBD — e.g. cancel anytime, effective end of current
  billing period vs. immediate.]
- Budget caps you configure per department (Section 2) limit what agents
  can *spend on your behalf through connected tools* (e.g., email sends
  counted against a department's cap) — this is separate from and does not
  limit your Foundry subscription charges themselves.

## 6. Suspension and termination

We may suspend or terminate your access to Foundry, in whole or in part,
if:

- You violate Section 3 (Acceptable Use);
- Your account has a payment failure that isn't resolved within a
  reasonable cure period;
- We reasonably believe continued access poses a security, legal, or
  operational risk to us, you, or a third party (for example, an
  organization's agents are actively sending abusive email or attempting
  to exceed guardrail limits); or
- Required by law or a third-party provider we depend on (e.g., our email
  or model provider suspending access to their own service).

You may stop using Foundry and, subject to Section 5, cancel your
subscription at any time. On termination, we will [describe data
export/retention on offboarding — TBD, see also the Privacy Policy's
retention section, which is currently a known gap].

## 7. Limitation of liability

Because Foundry agents can take real actions with real-world consequences
— sending emails on your behalf, writing files, spending against a budget
you set — you should understand these limits before granting autonomy:

- To the maximum extent permitted by law, Foundry and its operator will
  not be liable for indirect, incidental, special, consequential, or
  punitive damages, or for lost profits, lost data, or reputational harm,
  arising from your use of the service — including from actions an
  autonomous agent took within the bounds of the autonomy level and budget
  caps you configured.
- To the maximum extent permitted by law, our total liability for any
  claim arising from these Terms or the service will not exceed [the
  amount you paid us in the 12 months before the claim / a fixed cap —
  TBD, needs a real number chosen with counsel].
- Nothing in this section is intended to (and nothing here should be read
  to) limit liability where the law does not allow it to be limited (for
  example, liability for our own gross negligence or willful misconduct,
  where applicable law prohibits limiting it).
- This section does not replace the guardrail system described in Section
  2 — it describes the legal allocation of risk for actions that guardrail
  system did, correctly, allow because you configured it to.

## 8. Changes to these Terms

We may update these Terms as the product develops (this is an early-stage
product and we expect to). We will [describe notice mechanism — e.g. email
notice, in-app banner — TBD] before material changes take effect.

## 9. Governing law

**[JURISDICTION — TBD, needs Saransh's decision + real legal review. Do
not guess a country/state/venue.]**

## 10. Contact

Questions about these Terms: **[CONTACT EMAIL — TBD, needs a real
support/legal contact address]**.

---

### Placeholders left in this document

- `[As of this draft, billing runs in Stripe test mode only...]` — confirm before going live.
- `[Refund policy: TBD ...]`
- `[Cancellation terms: TBD ...]`
- `[describe data export/retention on offboarding — TBD ...]`
- `[the amount you paid us in the 12 months before the claim / a fixed cap — TBD, needs a real number chosen with counsel]`
- `[describe notice mechanism ...]`
- `[JURISDICTION — TBD, needs Saransh's decision + real legal review.]`
- `[CONTACT EMAIL — TBD, needs a real support/legal contact address]`

Also not yet filled in anywhere in this document, needed before publication:
business entity legal name/type and registered address (not present at all
— add a Section 0 "About us" once decided).
