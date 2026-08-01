"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

const NAV = [
  { href: "/dashboard/run", label: "Run a task", blurb: "Give your company something to do" },
  { href: "/dashboard/approvals", label: "Approvals", blurb: "Say yes or no" },
  { href: "/dashboard/departments", label: "Departments", blurb: "Turn agents on, set how free they are" },
  { href: "/dashboard/prompts", label: "Agent prompts", blurb: "Edit what each agent is told to do" },
  { href: "/dashboard/budgets", label: "Budgets", blurb: "Spending limits" },
  { href: "/dashboard/tools", label: "Tool allowlist", blurb: "Turn off one specific action" },
  { href: "/dashboard/activity", label: "Activity", blurb: "Everything that's happened" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <aside className="rail">
        <Link href="/" className="wordmark">
          Foundry
        </Link>
        <ul className="rail-nav">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
                {item.label}
                <small>{item.blurb}</small>
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <UserButton />
          <OrganizationSwitcher hidePersonal />
        </div>
      </aside>
      <div className="main">
        {/* Keying by pathname remounts this div on every navigation, which is
            what re-triggers the CSS fade-in — a plain className would only
            animate once, on first load. CSS-only, no transition library. */}
        <div key={pathname} className="page-transition">
          {children}
        </div>
      </div>
    </div>
  );
}
