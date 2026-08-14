import { test, expect } from "@playwright/test";

test("toggling a tool's allowlist entry persists across a reload", async ({ page }) => {
  await page.goto("/dashboard/tools");
  await expect(page.getByRole("heading", { name: "Tool allowlist" })).toBeVisible();

  const row = page.locator("tr", { hasText: "save_project_file" }).first();
  const checkbox = row.locator('input[type="checkbox"]');
  const wasAllowed = await checkbox.isChecked();

  await checkbox.click();
  await row.getByRole("button", { name: "Save" }).click();

  await page.reload();
  const reloadedRow = page.locator("tr", { hasText: "save_project_file" }).first();
  await expect(reloadedRow.locator('input[type="checkbox"]')).toBeChecked({ checked: !wasAllowed });

  // Restore original state so repeated CI runs don't drift the org's config.
  await reloadedRow.locator('input[type="checkbox"]').click();
  await reloadedRow.getByRole("button", { name: "Save" }).click();
  await page.reload();
  const finalRow = page.locator("tr", { hasText: "save_project_file" }).first();
  await expect(finalRow.locator('input[type="checkbox"]')).toBeChecked({ checked: wasAllowed });
});
