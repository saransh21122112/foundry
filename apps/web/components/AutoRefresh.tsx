"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server component's data current without a manual reload — mount
 * inside a page that fetches straight from the DB (e.g. Activity) so a real
 * run's rows show up on their own instead of only after an F5. `router.refresh()`
 * re-runs the server component in place; it doesn't reset any client state
 * elsewhere on the page.
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
