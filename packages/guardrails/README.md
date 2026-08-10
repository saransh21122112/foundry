# packages/guardrails

The autonomy/budget/approval enforcement code every gated agent tool call
runs through. Read `src/enforce.ts` directly for the actual logic — the
root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) has a summary, but this
file is the source of truth.

```bash
npm run typecheck
npm run test        # unit-tested against in-memory fakes (deps-db.test.ts's
                     # shape), not a live database — see src/*.test.ts
```

## Layout

- `src/enforce.ts` — the main entry point: kill switch → department
  enabled → autonomy level → hard-rule risk classes
  (`irreversible`/`financial`/`legal`, always require approval) → tool
  allowlist → budget cap → rate limit.
- `src/types.ts` — `GuardrailDeps`, the interface `enforce()` is written
  against (so it can be tested against fakes instead of a live DB).
- `src/deps-db.ts` — the real, Postgres-backed implementation of
  `GuardrailDeps`, used by every actual tool call in production. Also
  where approval-request admin-notification emails get sent.
- `src/budget-decision.ts` — pure budget-cap math, factored out so it's
  independently testable.
- `src/assert-not-killed.ts` — the lighter-weight check ungated
  (`riskClass: "reversible-low"`) read tools call directly, instead of the
  full `enforce()` path.
- `src/eve-adapter.ts` — wires `enforce()` into eve's own tool-approval
  hook shape (`makeApprovalPolicy`, what every gated tool's `approval:`
  field is built from).
