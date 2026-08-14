import { test, expect } from "@playwright/test";

// "Audit export" is the heading in both branches of this page (the Pro
// report and the free-plan upsell) — whichever plan the E2E org is
// actually on, this is a safe, non-flaky assertion either way.
test("compliance page renders for an org admin", async ({ page }) => {
  await page.goto("/dashboard/compliance");
  await expect(page.getByRole("heading", { name: "Audit export" })).toBeVisible();
});
