# Foundry E2E suite

Playwright tests against the real deployed stack (no local dev server). Runs in CI via `.github/workflows/e2e.yml` — on a schedule, on demand, and after every deploy.

## One-time manual setup

1. **Seed a Clerk test user**: in the Clerk dashboard (or via the Backend API), create a real user with password auth enabled, add them to a real org, and give them the `org:admin` role. `@clerk/testing` signs this user in headlessly — it does not create the user or provision org membership.
2. **Set GitHub Actions repo configuration** (Settings → Secrets and variables → Actions):
   - Secrets: `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD` (the seeded user above), `CLERK_SECRET_KEY`, `SLACK_WEBHOOK_URL` (optional, failure notifications).
   - Variables: `BASE_URL` (the ALB DNS name), `CLERK_PUBLISHABLE_KEY`, `E2E_CLERK_ORG_ID` (the org ID from step 1 — being a *member* of an org isn't enough on its own; Clerk sessions track an *active* org separately, and every page here reads `auth()`'s `orgId`. Without this, `tests/auth.setup.ts` signs in successfully but every subsequent test hits the app's "sign in and select an organization" empty state instead of real content — confirmed live as the root cause of an entire first E2E run failing across unrelated-looking tests).

## Running locally

```bash
npm install
cd e2e
BASE_URL=http://<alb-dns-name> \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... \
CLERK_SECRET_KEY=sk_test_... \
E2E_CLERK_USER_EMAIL=... \
E2E_CLERK_USER_PASSWORD=... \
E2E_CLERK_ORG_ID=org_... \
npx playwright test
```

## Coverage

A floor to extend, not a finished suite — departments toggle persistence, task submission/transcript rendering, the approval park→approve→resume flow (a real regression test for a resume-reliability bug found and partially fixed in this app), webhook + GitHub connections, graph/activity/compliance page rendering, and a couple of API-level checks (health endpoint, auth-required redirect).
