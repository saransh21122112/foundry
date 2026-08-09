import { test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

const authFile = "playwright/.auth/user.json";

// Signs in once and saves storage state for every other test to reuse —
// Clerk's own recommended pattern (clerk.com/docs/guides/development/
// testing/playwright/test-authenticated-flows), avoids a real sign-in
// round-trip per test file. Requires a real Clerk test user, password auth
// enabled, already a member of an org with org:admin (see e2e/README.md) —
// @clerk/testing signs the user in but doesn't provision org membership.
setup("authenticate", async ({ page }) => {
  await clerkSetup();

  const email = process.env.E2E_CLERK_USER_EMAIL;
  const password = process.env.E2E_CLERK_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD must be set.");
  }

  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier: email, password },
  });

  await page.goto("/dashboard/run");
  await page.waitForSelector("h1:has-text('Run a task')");

  await page.context().storageState({ path: authFile });
});
