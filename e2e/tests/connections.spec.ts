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

  await Promise.all([
    page.waitForURL(/github\.com\/login\/oauth\/authorize/, { timeout: 10_000 }),
    page.getByRole("button", { name: "Connect GitHub" }).click(),
  ]);

  const url = new URL(page.url());
  expect(url.hostname).toBe("github.com");
  expect(url.searchParams.get("scope")).toBe("repo");
  expect(url.searchParams.get("redirect_uri")).toContain("/dashboard/connections/github/callback");
  expect(url.searchParams.get("state")).toBeTruthy();
});
