"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { NAV } from "@/lib/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Polls a tiny org-scoped count route (app/api/failure-count) rather than
  // fetching from the DB here directly — this layout is "use client" and
  // stays that way; a small poll is less disruptive than converting it to
  // fetch server-side just for one badge. Mirrors AutoRefresh's interval
  // pattern used on the Activity page.
  const [failureCount, setFailureCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/failure-count")
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setFailureCount(data.count ?? 0);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
                {item.href === "/dashboard/activity" && failureCount > 0 ? (
                  <span className="badge badge-risk-financial" style={{ marginLeft: 8 }}>
                    {failureCount}
                  </span>
                ) : null}
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
