# Foundry E2E suite

Playwright tests against the real deployed stack (no local dev server). Runs in CI via `.github/workflows/e2e.yml` — on a schedule, on demand, and after every deploy.

## One-time manual setup

1. **Seed a Clerk test user**: in the Clerk dashboard, create a real user with password auth enabled, add them to a real org, and give them the `org:admin` role. `@clerk/testing` signs this user in headlessly — it does not create the user or provision org membership.
2. **Set GitHub Actions repo configuration** (Settings → Secrets and variables → Actions):
   - Secrets: `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD` (the seeded user above), `CLERK_SECRET_KEY`, `SLACK_WEBHOOK_URL` (optional, failure notifications).
   - Variables: `BASE_URL` (the ALB DNS name), `CLERK_PUBLISHABLE_KEY`.

## Running locally

```bash
npm install
cd e2e
BASE_URL=http://<alb-dns-name> \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... \
CLERK_SECRET_KEY=sk_test_... \
E2E_CLERK_USER_EMAIL=... \
E2E_CLERK_USER_PASSWORD=... \
npx playwright test
```

## Coverage

A floor to extend, not a finished suite — departments toggle persistence, task submission/transcript rendering, the approval park→approve→resume flow (a real regression test for a resume-reliability bug found and partially fixed in this app), webhook + GitHub connections, graph/activity/compliance page rendering, and a couple of API-level checks (health endpoint, auth-required redirect).
