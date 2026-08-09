import { test, expect } from "@playwright/test";

test("submitting a task renders a real transcript", async ({ page }) => {
  await page.goto("/dashboard/run");

  const startNewTaskButton = page.getByRole("button", { name: "Start a new task" });
  if (await startNewTaskButton.isVisible().catch(() => false)) {
    await startNewTaskButton.click();
  }

  await page.getByPlaceholder(/Research two competitors/).fill("Say hello and confirm you are working.");
  await page.getByRole("button", { name: "Run", exact: true }).click();

  // The transcript starts with the operator's own message, then the agent's
  // reply — assert both actually render, not just that the page didn't crash.
  await expect(page.getByText("Say hello and confirm you are working.")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".transcript-entry-agent").first()).toBeVisible({ timeout: 60_000 });
});
