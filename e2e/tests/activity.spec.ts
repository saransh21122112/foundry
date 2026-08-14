import { test, expect } from "@playwright/test";

test("activity log page renders, including the failures-only filter", async ({ page }) => {
  await page.goto("/dashboard/activity");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

  await page.getByRole("link", { name: "Failures only" }).click();
  await expect(page).toHaveURL(/filter=failed/);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});
