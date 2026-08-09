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

  // Being a member of an org (set up via the Clerk Backend API when this
  // test user was created) is not the same as that org being the session's
  // *active* org — every page here reads `auth()`'s `orgId`, which is null
  // until something sets it active. Without this, every dashboard page
  // rendered its "Sign in and select or create an organization" empty
  // state instead of real content, and every test that looks for actual
  // page content (department cards, the webhook form, a run transcript)
  // timed out waiting for elements that were never going to appear —
  // confirmed live: this was the root cause of the first real E2E run's
  // failures, not bugs in the app or the individual tests.
  const orgId = process.env.E2E_CLERK_ORG_ID;
  if (!orgId) {
    throw new Error("E2E_CLERK_ORG_ID must be set (the org the E2E user is a member of).");
  }
  await page.evaluate(async (id) => {
    await window.Clerk?.setActive({ organization: id });
  }, orgId);

  await page.goto("/dashboard/run");
  await page.waitForSelector("h1:has-text('Run a task')");

  await page.context().storageState({ path: authFile });
});
