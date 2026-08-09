import { test, expect } from "@playwright/test";

// Regression test for a real bug found and partially fixed in this app: a
// gated tool call parking for approval didn't reliably resume after being
// approved. Deliberately uses eng-lead's own save_project_file (one level
// of subagent delegation) rather than a nested swe-lead child — the known
// flakier, still-being-investigated path — so this stays a clean signal on
// the base approval-resume mechanism itself.
test("a gated tool call parks for approval and resumes once approved", async ({ page }) => {
  await page.goto("/dashboard/departments");
  const engLeadCard = page.locator("div.panel", { hasText: "eng-lead" });
  const draftsOnly = engLeadCard.getByRole("radio", { name: /Drafts only/ });
  const wasDraftsOnly = await draftsOnly.isChecked();
  if (!wasDraftsOnly) {
    await engLeadCard.getByRole("checkbox", { name: "Turn this department on" }).check();
    await draftsOnly.check();
    await engLeadCard.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }

  await page.goto("/dashboard/run");
  const startNewTaskButton = page.getByRole("button", { name: "Start a new task" });
  if (await startNewTaskButton.isVisible().catch(() => false)) {
    await startNewTaskButton.click();
  }

  const slug = `e2e-${Date.now()}`;
  await page
    .getByPlaceholder(/Research two competitors/)
    .fill(`eng-lead: call save_project_file with projectSlug ${slug}, relativePath index.html, contents <h1>e2e</h1>. Just save it.`);
  await page.getByRole("button", { name: "Run", exact: true }).click();

  await expect(page.getByText("Paused — this needs your approval")).toBeVisible({ timeout: 60_000 });

  await page.goto("/dashboard/approvals");
  const approvalRow = page.locator("div.panel", { hasText: "save_project_file" }).first();
  await expect(approvalRow).toBeVisible({ timeout: 15_000 });
  await approvalRow.getByRole("button", { name: "Approve" }).click();
  await expect(approvalRow).toBeHidden({ timeout: 15_000 });

  await page.goto("/dashboard/activity");
  await expect(page.getByText("save_project_file").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Ran successfully/).first()).toBeVisible({ timeout: 45_000 });
});
