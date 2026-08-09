import { test, expect } from "@playwright/test";

test("Live activity graph renders without error", async ({ page }) => {
  await page.goto("/dashboard/graph");
  await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();
});

test("Activity log renders without error", async ({ page }) => {
  await page.goto("/dashboard/activity");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});

test("Compliance page renders without error", async ({ page }) => {
  await page.goto("/dashboard/compliance");
  await expect(page.locator("h1")).toBeVisible();
});
