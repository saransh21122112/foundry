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
  // Clerk's setActive requires an explicit `session` unless one is already
  // active on the client (confirmed live: without it, Clerk throws
  // "setActive should either be called with a session param or there
  // should be already an active session"). And `window.Clerk.session`
  // isn't necessarily populated the instant signIn() resolves — wait for
  // it explicitly rather than assuming it's already there (also confirmed
  // live: checking immediately threw "No active Clerk session").
  try {
    await page.waitForFunction(() => Boolean(window.Clerk?.session?.id), { timeout: 15_000 });
  } catch (err) {
    // clerk.signIn() above doesn't throw even when the session never
    // activates — it awaits Clerk.setActive() internally and only surfaces
    // an error if signIn.create() itself rejects, not if it completes
    // without producing a session (e.g. the account needs a second
    // factor/verification the password-only call above doesn't satisfy).
    // Every run has failed at this exact line since the workflow started —
    // a real, deterministic bug, not flakiness — so surface Clerk's own
    // sign-in status instead of just "timed out" to make the next failure
    // self-diagnosing rather than a second blind guess.
    const status = await page.evaluate(() => ({
      signInStatus: window.Clerk?.client?.signIn?.status ?? null,
      firstFactorStatus: window.Clerk?.client?.signIn?.firstFactorVerification?.status ?? null,
      secondFactorStatus: window.Clerk?.client?.signIn?.secondFactorVerification?.status ?? null,
    }));
    throw new Error(
      `Clerk session never activated after sign-in (${JSON.stringify(status)}). Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await page.evaluate(async (id) => {
    const sessionId = window.Clerk!.session!.id;
    await window.Clerk!.setActive({ session: sessionId, organization: id });
  }, orgId);

  await page.goto("/dashboard/run");
  await page.waitForSelector("h1:has-text('Run a task')");

  await page.context().storageState({ path: authFile });
});
