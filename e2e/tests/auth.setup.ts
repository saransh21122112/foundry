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
  // Playwright's default 30s test timeout was getting eaten by clerkSetup()
  // + page.goto() + clerk.signIn()'s own real network round trips before
  // the 15s waitForFunction below even started — confirmed live: the
  // diagnostic added in the catch block below never got to run because the
  // outer test timeout closed the page first ("Target page, context or
  // browser has been closed" instead of the intended status dump).
  setup.setTimeout(60_000);
  // Every run so far has hung for the full 60s test timeout with no way to
  // tell which step actually stalled — the diagnostic evaluate() added
  // after the last failure never even got a chance to run (or itself
  // hung; the log couldn't distinguish the two). Timestamped step markers
  // instead of another blind guess: the next failure's log will show
  // exactly where the time went.
  const t0 = Date.now();
  const mark = (label: string) => console.log(`[auth.setup] ${label} at +${Date.now() - t0}ms`);

  await clerkSetup();
  mark("clerkSetup() done");

  const email = process.env.E2E_CLERK_USER_EMAIL;
  const password = process.env.E2E_CLERK_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD must be set.");
  }

  await page.goto("/");
  mark("page.goto('/') done");
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier: email, password },
  });
  mark("clerk.signIn() done");

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
    mark("waitForFunction resolved (session active)");
  } catch (err) {
    mark("waitForFunction rejected (timed out) — reading Clerk's own status");
    // clerk.signIn() above doesn't throw even when the session never
    // activates — it awaits Clerk.setActive() internally and only surfaces
    // an error if signIn.create() itself rejects, not if it completes
    // without producing a session (e.g. the account needs a second
    // factor/verification the password-only call above doesn't satisfy).
    // Every run has failed at this exact line since the workflow started —
    // a real, deterministic bug, not flakiness — so surface Clerk's own
    // sign-in status instead of just "timed out" to make the next failure
    // self-diagnosing rather than a second blind guess. Wrapped with its
    // own short timeout: the previous attempt at this diagnostic itself
    // seemingly hung (or never ran) for the rest of the 60s test budget —
    // an evaluate() that can't even read a plain object off window.Clerk
    // within 5s means the page itself is stuck (e.g. an in-flight
    // navigation triggered by Clerk.setActive()), which is itself the
    // finding, not a bug in the diagnostic.
    const status = await Promise.race([
      page.evaluate(() => ({
        signInStatus: window.Clerk?.client?.signIn?.status ?? null,
        firstFactorStatus: window.Clerk?.client?.signIn?.firstFactorVerification?.status ?? null,
        secondFactorStatus: window.Clerk?.client?.signIn?.secondFactorVerification?.status ?? null,
        url: window.location.href,
      })),
      new Promise<string>((resolve) => setTimeout(() => resolve("evaluate() itself did not return within 5s — page is unresponsive, likely a stuck in-flight navigation"), 5_000)),
    ]);
    mark(`diagnostic done: ${JSON.stringify(status)}`);
    throw new Error(
      `Clerk session never activated after sign-in (${JSON.stringify(status)}). Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await page.evaluate(async (id) => {
    const sessionId = window.Clerk!.session!.id;
    await window.Clerk!.setActive({ session: sessionId, organization: id });
  }, orgId);
  mark("setActive(orgId) done");

  await page.goto("/dashboard/run");
  await page.waitForSelector("h1:has-text('Run a task')");
  mark("dashboard/run loaded");

  await page.context().storageState({ path: authFile });
});
