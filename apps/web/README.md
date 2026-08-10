# apps/web

The Next.js (App Router) dashboard — Clerk auth, org/department settings,
approvals, budgets, connections, billing (Stripe). Talks to
`apps/agent-runtime` over HTTP (`lib/eve-client.ts`) to start/resume agent
sessions, and reads/writes `packages/db` directly for everything else.

See the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full
request-flow picture. Locally:

```bash
cp .env.example .env.local   # fill in real values
npm run dev                  # next dev
npm run typecheck
npm run test                 # lib/**/*.test.ts
```

## Layout

- `app/dashboard/<page>/` — one route per feature, each with a `page.tsx`
  (server component, does the `auth()` → `ensureOrganization()` → query
  dance) and, where there's real interactivity, a colocated `actions.ts`
  (server actions) and/or one named client component.
- `app/api/` — webhook receivers (Stripe) and small JSON endpoints the
  dashboard's own client components poll.
- `lib/` — shared server-side logic: `authz.ts` (permission checks),
  `compliance.ts` (compliance report generation), `graph-data.ts` (the
  live department-graph query, shared by `/` and `/dashboard/graph`),
  `nav.ts` (single source of truth for the sidebar + homepage nav list),
  `stripe.ts`, `eve-client.ts`.
- `components/` — shared client components used across more than one page.
