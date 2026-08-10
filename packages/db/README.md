# packages/db

Drizzle ORM schema + migrations, shared by `apps/web` and
`apps/agent-runtime` — both talk to the same Postgres (RDS in production)
directly through this package, there's no API layer between them.

```bash
cp .env.example .env
npm run typecheck
npm run test                # src/**/*.test.ts
npm run generate            # after editing src/schema.ts — writes a new migrations/*.sql
```

## Layout

- `src/schema.ts` — every table, in one file. Changing it means running
  `npm run generate` to produce a new migration under `migrations/`
  (never hand-edit an existing migration file).
- `src/client.ts` — the `db` export both apps import; lazily connects on
  first use (`DATABASE_URL` or the discrete `PGHOST`/etc), so importing
  `@foundry/db` doesn't require a live database (used by
  `packages/guardrails`'s unit tests, which run against fakes instead).
- `src/crypto.ts` — AES-256-GCM encrypt/decrypt for stored OAuth tokens
  (GitHub, Google Calendar connections).
- `src/orgs.ts` — `ensureOrganization()`, the Clerk-org-to-DB-row resolver
  every dashboard page and agent session calls first.
- `src/migrate.ts` — one-off migration runner (see `DEPLOY.md`).
- `migrations/` — generated SQL, one file per `npm run generate` run. Never
  hand-edited.

See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for how this fits
into the rest of the system.
