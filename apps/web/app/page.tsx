"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, OrganizationSwitcher, useUser } from "@clerk/nextjs";

export default function HomePage() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <main className="hero">
      <p className="eyebrow">Autonomous AI company · control room</p>
      <h1>Foundry</h1>
      <p className="lede">
        Seven department agents, running on your behalf, at exactly the
        amount of heat you allow them — off, drafting for your review, or
        acting on their own within guardrails. Nothing runs hotter than the
        level you set.
      </p>

      {!isLoaded ? null : isSignedIn ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <UserButton />
            {/* An org must be created/selected before any tool call can be
                tenant-scoped — see apps/agent-runtime/agent/channels/eve.ts's
                clerkOrgSession(), which reads this from the session token. */}
            <OrganizationSwitcher hidePersonal />
          </div>
          <ul className="hero-nav">
            <li>
              <Link href="/dashboard/run">
                <span>
                  Run a task
                  <small>Give your company something to do</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/dashboard/approvals">
                <span>
                  Approval queue
                  <small>Actions waiting for your yes or no</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/dashboard/departments">
                <span>
                  Departments
                  <small>Turn agents on, decide how free they are</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/dashboard/budgets">
                <span>
                  Budget caps
                  <small>Spending limits per department</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/dashboard/tools">
                <span>
                  Tool allowlist
                  <small>Turn off one specific action</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/dashboard/activity">
                <span>
                  Activity log
                  <small>Everything that's happened, in order</small>
                </span>
              </Link>
            </li>
          </ul>
        </>
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <SignInButton>
            <button className="btn">Sign in</button>
          </SignInButton>
          <SignUpButton>
            <button className="btn btn-primary">Sign up</button>
          </SignUpButton>
        </div>
      )}

      <p className="lede" style={{ marginTop: 24 }}>
        <Link href="/about">About Foundry &amp; how the guardrails work →</Link>
      </p>
    </main>
  );
}
