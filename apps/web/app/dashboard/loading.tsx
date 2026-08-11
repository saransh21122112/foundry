/**
 * Shared across every nested /dashboard/* route (Next.js App Router
 * convention — a loading.tsx in a segment wraps its children in a
 * Suspense boundary automatically). Every dashboard page is an async
 * Server Component doing real DB queries before it can render anything;
 * without this, navigation shows nothing at all until that fetch
 * finishes. Generic on purpose — shape only, not per-page content, so one
 * file covers all of them instead of every page needing its own skeleton.
 */
export default function DashboardLoading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className="skeleton-line skeleton-eyebrow" />
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-lede" />
      <div className="panel skeleton-panel">
        <div className="skeleton-line" style={{ width: "40%" }} />
        <div className="skeleton-line" style={{ width: "85%" }} />
        <div className="skeleton-line" style={{ width: "65%" }} />
      </div>
      <div className="panel skeleton-panel">
        <div className="skeleton-line" style={{ width: "30%" }} />
        <div className="skeleton-line" style={{ width: "70%" }} />
      </div>
    </main>
  );
}
