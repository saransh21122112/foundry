import { test, expect } from "@playwright/test";

test("agent-runtime health endpoint responds", async ({ request }) => {
  const res = await request.get("/eve/v1/health");
  expect(res.ok()).toBeTruthy();
});

test("an unauthenticated visitor sees a sign-in prompt, not real org data", async ({ browser }) => {
  // Deliberately ignores this project's shared signed-in storageState — a
  // fresh, cookie-less context is the actual thing being tested here.
  //
  // This app's middleware.ts is plain clerkMiddleware() with no .protect()
  // route matcher — pages don't redirect an unauthenticated visitor away
  // from the URL, they render an inline "sign in" message instead (actual
  // gating happens at the server-action level, e.g. startTask/listTasks
  // both check auth() before touching any org data). So the real
  // assertion is "no org UI leaks", not "the URL changed".
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/dashboard/connections");
  // Unlike every other test here, this context is fresh and cookie-less —
  // it has to pay for Clerk's own "dev browser" handshake redirect chain
  // (a round trip through clerk.accounts.dev to set the dev-browser cookie,
  // see auth.setup.ts's own notes on this) before the page can even render,
  // a cost the storageState-sharing tests never pay. The default 5s expect
  // timeout was too tight for that (confirmed live: "element(s) not found"
  // at exactly 5000ms) — give it the same order of headroom as this
  // suite's other page-load assertions.
  await expect(page.getByText(/Sign in and select or create an organization/)).toBeVisible({ timeout: 15_000 });
  await context.close();
});
