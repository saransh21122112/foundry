import { defineConfig, devices } from "@playwright/test";

// Tests the real deployed stack (BASE_URL, the ALB DNS name) — no
// `webServer` block, this never starts a local server.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3311",
    trace: "on-first-retry",
    // Every scheduled run has failed the same way at auth.setup.ts since
    // this workflow started (confirmed live via `gh run list` — not
    // flaky), with only a text stack trace to go on. A screenshot/video of
    // what the page actually looked like when Clerk's session never
    // activated (CAPTCHA? error banner? blank page?) is the fastest way to
    // find the real cause without guessing at it blindly.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "e2e",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
});
