import Link from "next/link";
import { SignUpButton } from "@clerk/nextjs";

const PAGES = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/about", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
] as const;

/**
 * Shared bottom-of-page nav for the four marketing pages (home is its own
 * hero, so it doesn't render this — but links to the other three). Replaces
 * each page's own hand-rolled row of <Link><button> pairs, which had
 * already drifted (about had 3 links, pricing had 3 different ones, no
 * page linked to itself excluded consistently).
 */
export function MarketingLinks({ current }: { current: (typeof PAGES)[number]["href"] }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
      <SignUpButton>
        <button className="btn btn-primary">Sign up free</button>
      </SignUpButton>
      {PAGES.filter((p) => p.href !== current).map((p) => (
        <Link key={p.href} href={p.href}>
          <button className="btn">{p.label}</button>
        </Link>
      ))}
    </div>
  );
}
