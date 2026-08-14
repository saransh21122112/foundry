import { test, expect } from "@playwright/test";

test("setting a budget cap shows it in the table, and reset spend doesn't error", async ({ page }) => {
  await page.goto("/dashboard/budgets");
  await expect(page.getByRole("heading", { name: "Budget caps" })).toBeVisible();

  // department + scope + unit is the natural key (see updateBudgetCap) — a
  // fixed unit name here means repeated CI runs update the same row
  // instead of growing the table forever.
  await page.getByLabel("Department").selectOption("researcher");
  await page.getByLabel("Resets").selectOption("per_run");
  await page.getByLabel("Unit").fill("e2e_test_unit");
  await page.getByLabel("Cap amount").fill("100");
  await page.getByRole("button", { name: "Save" }).click();

  const row = page.locator("tr", { hasText: "e2e_test_unit" });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // No UI way to generate real spend outside a gated tool call actually
  // running — this only verifies the reset action round-trips cleanly,
  // not that a nonzero value actually goes to zero.
  await row.getByRole("button", { name: "Reset spend" }).click();
  await expect(row).toBeVisible({ timeout: 10_000 });
});
