import { test, expect } from "@playwright/test";

test("triggering and resolving a department kill switch blocks and restores it", async ({ page }) => {
  await page.goto("/dashboard/kill-switch");
  await expect(page.getByRole("heading", { name: "Kill switch" })).toBeVisible();

  // Scoped by heading, not just hasText — "researcher" also appears as a
  // plain <td> in the "Active now" table once killed, which a bare
  // hasText filter would also match, and the "Kill everything" panel is a
  // separate div.panel entirely.
  const researcherPanel = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "researcher" }) });
  await researcherPanel.getByRole("button", { name: "Kill researcher" }).click();

  await expect(researcherPanel.getByRole("button", { name: /^Resolve/ })).toBeVisible({ timeout: 10_000 });

  await researcherPanel.getByRole("button", { name: /^Resolve/ }).click();
  await expect(researcherPanel.getByRole("button", { name: "Kill researcher" })).toBeVisible({ timeout: 10_000 });
});
