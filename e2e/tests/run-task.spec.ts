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

  // Scoped to .transcript specifically — a plain page-wide getByText also
  // matches the textarea itself (React SSRs a controlled textarea's initial
  // value as a child text node, confirmed live) and, worse, every past run's
  // identically-titled entry in the "recent tasks" sidebar (.task-list),
  // which only grows across repeated CI runs — a bare getByText became a
  // strict-mode violation with 2, 3, then 4 matches across consecutive runs.
  const transcript = page.locator(".transcript");
  await expect(transcript.getByText("Say hello and confirm you are working.")).toBeVisible({ timeout: 15_000 });
  await expect(transcript.locator(".transcript-entry-agent").first()).toBeVisible({ timeout: 60_000 });
});
