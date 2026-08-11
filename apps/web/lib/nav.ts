/**
 * Single source of truth for the dashboard's page list — used by both the
 * sidebar rail (`dashboard/layout.tsx`) and the signed-in homepage's own
 * nav list (`app/page.tsx`). Previously each kept its own hardcoded copy;
 * the homepage's silently drifted out of date as new pages (Kill switch,
 * Agent prompts, Connections, Get set up) were added to the rail but never
 * back-ported here — reported live as the homepage "start" screen missing
 * half the product. One list now, both surfaces read it.
 */
export const NAV = [
  { href: "/dashboard/onboarding", label: "Get set up", blurb: "First-run setup" },
  { href: "/dashboard/run", label: "Run a task", blurb: "A real terminal on this deployment's own host" },
  { href: "/dashboard/tasks", label: "Delegate a task", blurb: "Give your company something to do, by chat" },
  { href: "/dashboard/calendar", label: "Calendar", blurb: "Tasks by day, and by status" },
  { href: "/dashboard/approvals", label: "Approvals", blurb: "Say yes or no" },
  { href: "/dashboard/kill-switch", label: "Kill switch", blurb: "Emergency stop, org-wide or per department" },
  { href: "/dashboard/departments", label: "Departments", blurb: "Turn agents on, set how free they are" },
  { href: "/dashboard/prompts", label: "Agent prompts", blurb: "Edit what each agent is told to do" },
  { href: "/dashboard/budgets", label: "Budgets", blurb: "Spending limits" },
  { href: "/dashboard/connections", label: "Connections", blurb: "Outbound webhooks (Slack/Discord/Zapier)" },
  { href: "/dashboard/tools", label: "Tool allowlist", blurb: "Turn off one specific action" },
  { href: "/dashboard/graph", label: "Live activity", blurb: "Who's working on what, right now" },
  { href: "/dashboard/kpis", label: "Live metrics", blurb: "Tool calls, approvals, and budget spend, last 24h" },
  { href: "/dashboard/activity", label: "Activity", blurb: "Everything that's happened" },
  { href: "/dashboard/compliance", label: "Compliance", blurb: "Proof every risky action had sign-off" },
  { href: "/dashboard/billing", label: "Billing", blurb: "Plan and upgrades" },
] as const;
