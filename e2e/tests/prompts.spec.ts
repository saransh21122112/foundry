import { test, expect } from "@playwright/test";

test("editing and saving an agent's prompt persists across a reload", async ({ page }) => {
  await page.goto("/dashboard/prompts");
  await expect(page.getByRole("heading", { name: "Agent prompts" })).toBeVisible();

  // rows=24, class "mono" — distinct from the "About this organization" and
  // "Describe a change" textareas above it, which share the page.
  const promptTextarea = page.locator("textarea.mono");
  const original = await promptTextarea.inputValue();
  const marker = `e2e-marker-${Date.now()}`;

  // This page has three separate "Save" buttons (org profile, prompt) — a
  // bare getByRole would be ambiguous, so scope to the panel containing
  // the prompt textarea specifically.
  const promptPanel = page.locator("div.panel").filter({ has: promptTextarea });
  async function save(value: string) {
    await promptTextarea.fill(value);
    await promptPanel.getByRole("button", { name: "Save" }).click();
    await expect(promptPanel.getByText("Saved.")).toBeVisible({ timeout: 10_000 });
  }

  await save(`${original}\n${marker}`);
  await page.reload();
  await expect(page.locator("textarea.mono")).toHaveValue(new RegExp(marker));

  // Restore original content so repeated CI runs don't grow this forever.
  await save(original);
});
