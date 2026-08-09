import { test, expect } from "@playwright/test";

test("toggling a department on persists across a reload", async ({ page }) => {
  await page.goto("/dashboard/departments");
  await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();

  const researcherCard = page.locator("div.panel", { hasText: "researcher" });
  const checkbox = researcherCard.getByRole("checkbox", { name: "Turn this department on" });
  const wasOn = await checkbox.isChecked();

  if (!wasOn) await checkbox.check();
  await researcherCard.getByRole("radio", { name: /Drafts only/ }).check();
  await researcherCard.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.reload();
  const reloadedCard = page.locator("div.panel", { hasText: "researcher" });
  await expect(reloadedCard.getByRole("checkbox", { name: "Turn this department on" })).toBeChecked();

  // Restore original state so repeated CI runs don't drift the org's config.
  if (!wasOn) {
    await reloadedCard.getByRole("checkbox", { name: "Turn this department on" }).uncheck();
    await reloadedCard.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }
});
