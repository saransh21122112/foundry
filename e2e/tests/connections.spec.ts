import { test, expect } from "@playwright/test";

test("webhook connection can be saved and removed", async ({ page }) => {
  await page.goto("/dashboard/connections");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();

  const url = `https://hooks.slack.com/services/E2E/${Date.now()}`;
  await page.getByLabel("Webhook URL").fill(url);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(url)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No webhook connected yet.")).toBeVisible({ timeout: 10_000 });
});

// Full headless GitHub OAuth login is out of scope (needs a dedicated bot
// GitHub account and is inherently flaky in CI) — this checks the redirect
// itself is correctly formed instead of completing the flow.
test("Connect GitHub redirects to a correctly-formed GitHub authorize URL", async ({ page }) => {
  await page.goto("/dashboard/connections");

  // A prior run (manual or automated) may have already connected GitHub —
  // disconnect first so "Connect GitHub" is actually there to click.
  const disconnectButton = page.getByRole("button", { name: "Disconnect" });
  if (await disconnectButton.isVisible().catch(() => false)) {
    await disconnectButton.click();
    await expect(page.getByText("No GitHub account connected yet.")).toBeVisible({ timeout: 10_000 });
  }

  // waitForURL (default waitUntil: "load") only ever observes the FINAL
  // URL of a server-side redirect chain, not an intermediate hop — GitHub
  // itself immediately 302s an unauthenticated browser from
  // /login/oauth/authorize onward to /login before that first URL ever
  // fires a 'load' event, so the page never actually "arrives" there from
  // Playwright's perspective (confirmed live: every run landed on
  // /login?...&return_to=... instead, and the wait timed out). Watch for
  // the outgoing *request* instead — that's real regardless of whether the
  // browser ever renders that page, so it isn't racing GitHub's own
  // redirect at all.
  const [request] = await Promise.all([
    page.waitForRequest(/github\.com\/login\/oauth\/authorize/, { timeout: 10_000 }),
    page.getByRole("button", { name: "Connect GitHub" }).click(),
  ]);

  const url = new URL(request.url());
  expect(url.hostname).toBe("github.com");
  expect(url.searchParams.get("scope")).toBe("repo");
  expect(url.searchParams.get("redirect_uri")).toContain("/dashboard/connections/github/callback");
  expect(url.searchParams.get("state")).toBeTruthy();
});

// Same reasoning as the GitHub test above — checks the redirect is
// correctly formed, doesn't complete a real Google login.
test("Connect Google Calendar redirects to a correctly-formed Google authorize URL", async ({ page }) => {
  await page.goto("/dashboard/connections");

  const disconnectButton = page.getByRole("button", { name: "Disconnect" });
  if (await disconnectButton.isVisible().catch(() => false)) {
    await disconnectButton.click();
    await expect(page.getByText("No Google account connected yet.")).toBeVisible({ timeout: 10_000 });
  }

  const [request] = await Promise.all([
    page.waitForRequest(/accounts\.google\.com\/o\/oauth2\/v2\/auth/, { timeout: 10_000 }),
    page.getByRole("button", { name: "Connect Google Calendar" }).click(),
  ]);

  const url = new URL(request.url());
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly");
  expect(url.searchParams.get("redirect_uri")).toContain("/dashboard/connections/google-calendar/callback");
  expect(url.searchParams.get("state")).toBeTruthy();
});

// Doesn't need a real Telegram account — generating the code is entirely
// in-app (no external redirect), unlike GitHub/Google above.
test("Telegram link code can be generated", async ({ page }) => {
  await page.goto("/dashboard/connections");

  const generateNew = page.getByRole("button", { name: "Generate a new code" });
  const getCode = page.getByRole("button", { name: "Get a link code" });
  if (await generateNew.isVisible().catch(() => false)) {
    await generateNew.click();
  } else {
    await getCode.click();
  }

  await expect(page.getByText(/\/link \S+/)).toBeVisible({ timeout: 10_000 });
});
