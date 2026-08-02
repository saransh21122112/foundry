import { and, count, eq, gte } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { activityLog, db, ensureOrganization } from "@foundry/db";

/**
 * Lightweight org-scoped count of `tool_call_failed` rows in the last 24h,
 * polled by the nav rail's failure badge (see DashboardLayout). Mirrors the
 * auth pattern from app/api/agent-stream/[sessionId]/route.ts.
 */
export async function GET() {
  const { orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkOrgId) return Response.json({ count: 0 });

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ value: count() })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.orgId, org.id),
        eq(activityLog.eventType, "tool_call_failed"),
        gte(activityLog.timestamp, since),
      ),
    );

  return Response.json({ count: row?.value ?? 0 });
}
