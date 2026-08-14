import { test, expect } from "@playwright/test";

// Doesn't click "Upgrade to Pro" — that's a real Stripe checkout redirect,
// out of scope the same way a full GitHub/Google OAuth login is (see
// connections.spec.ts).
test("billing page shows the org's current plan", async ({ page }) => {
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.getByText(/free|pro/i).first()).toBeVisible();
});
