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
  await expect(page.getByText(/Sign in and select or create an organization/)).toBeVisible();
  await context.close();
});
