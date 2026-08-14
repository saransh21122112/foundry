import { test, expect } from "@playwright/test";

// Applies to every test in this file — the health-check test below doesn't
// use `page`/`context` at all, so it's unaffected. Overriding storageState
// here, not by manually calling browser.newContext(), because the browser
// *fixture* (unlike the raw Playwright Browser class) inherits the
// project's `use` defaults — including the "e2e" project's shared,
// signed-in storageState — into ANY context it creates, manual or not.
// Confirmed live: a supposedly "fresh, cookie-less" browser.newContext()
// call still carried a real clerk_active_context session cookie and
// rendered the fully authenticated dashboard. test.use() is the documented
// way to actually get an empty context for one file (playwright.dev/docs/auth).
test.use({ storageState: { cookies: [], origins: [] } });

test("agent-runtime health endpoint responds", async ({ request }) => {
  const res = await request.get("/eve/v1/health");
  expect(res.ok()).toBeTruthy();
});

test("an unauthenticated visitor sees a sign-in prompt, not real org data", async ({ page }) => {
  // This app's middleware.ts is plain clerkMiddleware() with no .protect()
  // route matcher — pages don't redirect an unauthenticated visitor away
  // from the URL, they render an inline "sign in" message instead (actual
  // gating happens at the server-action level, e.g. startTask/listTasks
  // both check auth() before touching any org data). So the real
  // assertion is "no org UI leaks", not "the URL changed".
  await page.goto("/dashboard/connections");
  // A genuinely fresh, cookie-less context pays for Clerk's own "dev
  // browser" handshake redirect chain (a round trip through
  // clerk.accounts.dev to set the dev-browser cookie, see auth.setup.ts's
  // own notes on this) before the page can even render — a cost the
  // storageState-sharing tests never pay. Give it real headroom.
  await expect(page.getByText(/Sign in and select or create an organization/)).toBeVisible({ timeout: 15_000 });
});
