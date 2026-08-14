import { test, expect } from "@playwright/test";

// The chat-composer UI this test exercises used to live at /dashboard/run —
// that page is a real node-pty shell now (see LiveTerminal.tsx). The
// composer itself wasn't removed, just moved to /dashboard/tasks
// (TaskBoard.tsx) — same placeholder, same "Run" button, same
// transcript-entry-* rendering, just a different URL.
test("submitting a task renders a real transcript", async ({ page }) => {
  await page.goto("/dashboard/tasks");

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
