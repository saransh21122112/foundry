import { test, expect } from "@playwright/test";

// Regression test for a real bug found and partially fixed in this app: a
// gated tool call parking for approval didn't reliably resume after being
// approved. Deliberately uses eng-lead's own save_project_file (one level
// of subagent delegation) rather than a nested swe-lead child — the known
// flakier, still-being-investigated path — so this stays a clean signal on
// the base approval-resume mechanism itself.
test("a gated tool call parks for approval and resumes once approved", async ({ page }) => {
  // This test's own step timeouts (60s + 15s + 15s + 45s + 45s = 180s)
  // already assume a real end-to-end flow — an actual LLM call to decide
  // on delegation, a real tool execution, another real LLM-driven resume
  // after approval — but nothing had ever overridden Playwright's default
  // 30s *overall* test timeout to match. Confirmed live: the test got
  // killed mid-resume with zero visible change on screen (no error, no
  // loading state, just cut off), well within every individual step's own
  // declared budget. Not a bug in the resume mechanism — a missing
  // test-level timeout for a test that was always going to need one.
  test.setTimeout(240_000);

  await page.goto("/dashboard/departments");
  // <section class="settings-section">, not div.panel — that class is used
  // elsewhere (e.g. the approval queue below), not on this page.
  const engLeadCard = page.locator("section.settings-section", { hasText: "eng-lead" });
  const draftsOnly = engLeadCard.getByRole("radio", { name: /Drafts only/ });
  const wasDraftsOnly = await draftsOnly.isChecked();
  if (!wasDraftsOnly) {
    await engLeadCard.getByRole("checkbox", { name: "Turn this department on" }).check();
    await draftsOnly.check();
    await engLeadCard.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }

  // The chat composer moved from /dashboard/run to /dashboard/tasks —
  // /dashboard/run is a real node-pty shell now (see LiveTerminal.tsx),
  // not a task-submission form.
  await page.goto("/dashboard/tasks");
  const startNewTaskButton = page.getByRole("button", { name: "Start a new task" });
  if (await startNewTaskButton.isVisible().catch(() => false)) {
    await startNewTaskButton.click();
  }

  // Describe the outcome, don't name the tool: the root orchestrator's own
  // system prompt (agent/instructions.default.ts) says it never does
  // department work itself, only delegates — but naming a specific
  // function ("call save_project_file with...") seems to prime it to
  // reason about whether IT has that function instead, and it answered
  // directly instead of delegating (confirmed live: "There's no
  // save_project_file function available to me or to the eng-lead
  // subagent" — a refusal from the root, not eng-lead, which does have
  // that tool at agent/subagents/eng-lead/tools/save_project_file.ts). A
  // natural-language task description leaves tool selection to eng-lead's
  // own judgment, same as a real user would phrase it.
  const slug = `e2e-${Date.now()}`;
  await page
    .getByPlaceholder(/Research two competitors/)
    .fill(`eng-lead: save a new project file named index.html with the contents <h1>e2e</h1>, in a new project called ${slug}.`);
  await page.getByRole("button", { name: "Run", exact: true }).click();

  await expect(page.getByText("Paused — this needs your approval")).toBeVisible({ timeout: 60_000 });

  await page.goto("/dashboard/approvals");
  const approvalRow = page.locator("div.panel", { hasText: "save_project_file" }).first();
  await expect(approvalRow).toBeVisible({ timeout: 15_000 });
  await approvalRow.getByRole("button", { name: "Approve" }).click();
  // Same class of wait as "Paused" above (60s) — resolveApproval's resume
  // call is a real end-to-end round trip (fetch the continuation token,
  // then a follow-up that drives another real LLM turn + tool execution,
  // see lib/eve-client.ts), not a cheap DB toggle. Confirmed live: the
  // trace showed the Approve click's own POST still in flight (status -1,
  // no error) when the old 15s timeout gave up — genuinely slow, not
  // stuck, so match the timeout to the other real-agent-turn waits here
  // instead of the DB-only interactions (which stay at 15s).
  await expect(approvalRow).toBeHidden({ timeout: 60_000 });

  await page.goto("/dashboard/activity");
  await expect(page.getByText("save_project_file").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Ran successfully/).first()).toBeVisible({ timeout: 45_000 });
});
