import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, departmentConfigs, ensureOrganization } from "@foundry/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { loadGraphNodes } from "@/lib/graph-data";
import { GraphView } from "./GraphView";

export default async function GraphPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Live activity</h1>
        <p className="lede">Sign in and select or create an organization to see who&apos;s working on what.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });

  // Nodes are this org's actually-enabled departments (department_configs),
  // never a hardcoded roster — a fresh org with nothing turned on sees an
  // empty state below instead of 7 dead-looking nodes. Cheap existence
  // check kept separate from loadGraphNodes so the empty-state copy here
  // can stay specific to this page (the homepage has its own).
  const [anyEnabled] = await db
    .select({ department: departmentConfigs.department })
    .from(departmentConfigs)
    .where(and(eq(departmentConfigs.orgId, org.id), eq(departmentConfigs.enabled, true)))
    .limit(1);

  if (!anyEnabled) {
    return (
      <main>
        <p className="eyebrow">Who&apos;s working on what</p>
        <h1>Live activity</h1>
        <p className="lede">
          No departments are turned on yet. <a href="/dashboard/departments">Turn one on</a> to see it here.
        </p>
      </main>
    );
  }

  const nodes = await loadGraphNodes(org.id);

  return (
    <main>
      <AutoRefresh intervalMs={4000} />
      <p className="eyebrow">Who&apos;s working on what</p>
      <h1>Live activity</h1>
      <p className="lede">
        Every department you&apos;ve turned on, live — a moving current means it logged something in the last two
        minutes, a red ring means it&apos;s waiting on you.
      </p>
      <GraphView nodes={nodes} orgLabel={orgSlug ?? "Your org"} />
    </main>
  );
}
