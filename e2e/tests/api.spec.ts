import { test, expect } from "@playwright/test";

test("agent-runtime health endpoint responds", async ({ request }) => {
  const res = await request.get("/eve/v1/health");
  expect(res.ok()).toBeTruthy();
});

test("dashboard routes require auth", async ({ browser }) => {
  // Deliberately ignores this project's shared signed-in storageState — a
  // fresh, cookie-less context is the actual thing being tested here.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/dashboard/run");
  await expect(page).not.toHaveURL(/\/dashboard\/run$/);
  await context.close();
});
