import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton, SignUpButton, UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { ensureOrganization } from "@foundry/db";
import { NAV } from "@/lib/nav";
import { ForgeIllustration } from "@/components/ForgeIllustration";
import { AutoRefresh } from "@/components/AutoRefresh";
import { loadGraphNodes } from "@/lib/graph-data";
import { GraphView } from "@/app/dashboard/graph/GraphView";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Signed-in-with-an-org visitors see the same live department graph
 * `/dashboard/graph` renders (via the shared loadGraphNodes loader,
 * apps/web/lib/graph-data.ts) directly on the homepage, instead of only a
 * plain link list — the reels that inspired this session's feature work
 * showed exactly this: a live "cortex" of department nodes as the landing
 * screen, not buried a click away. No new visualization code — this reuses
 * GraphView as-is. Everyone else (signed out, or no org yet) still gets the
 * original marketing hero below.
 */
export default async function HomePage() {
  const { userId, orgId: clerkOrgId, orgSlug } = await auth();
  const nodes = clerkOrgId
    ? await loadGraphNodes((await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined })).id)
    : [];

  return (
    <div className="hero-shell">
      <main className="hero">
        <p className="eyebrow">Autonomous AI company · control room</p>
        <h1>Foundry</h1>

        {userId && clerkOrgId ? (
          <>
            <p className="lede">
              {greeting()} — {orgSlug ?? "your org"}.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, marginBottom: 16 }}>
              <UserButton />
              <OrganizationSwitcher hidePersonal />
            </div>
            {nodes.length > 0 ? (
              <>
                <AutoRefresh intervalMs={4000} />
                <GraphView nodes={nodes} orgLabel={orgSlug ?? "Your org"} />
              </>
            ) : (
              <p className="lede">
                No departments are turned on yet. <Link href="/dashboard/departments">Turn one on</Link> to see it
                come alive here.
              </p>
            )}
            <ul className="hero-nav">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>
                    <span>
                      {item.label}
                      <small>{item.blurb}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="lede">
              Seven department agents, running on your behalf, at exactly the
              amount of heat you allow them — off, drafting for your review, or
              acting on their own within guardrails. Nothing runs hotter than the
              level you set.
            </p>
            {userId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <UserButton />
                {/* An org must be created/selected before any tool call can be
                    tenant-scoped — see apps/agent-runtime/agent/channels/eve.ts's
                    clerkOrgSession(), which reads this from the session token. */}
                <OrganizationSwitcher hidePersonal />
              </div>
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
          </>
        )}

        <p className="lede" style={{ marginTop: 24 }}>
          <Link href="/features">Features &amp; departments →</Link>
          {" · "}
          <Link href="/about">How the guardrails work →</Link>
          {" · "}
          <Link href="/pricing">Pricing →</Link>
        </p>
      </main>

      <div className="hero-art" aria-hidden="true">
        <ForgeIllustration />
      </div>
    </div>
  );
}
