import { and, eq } from "drizzle-orm";
import { db, departmentConfigs } from "@foundry/db";
import { ensureOrganization } from "@foundry/db";

const org = await ensureOrganization({ clerkOrgId: "org_3H9E02EEMPeyTdOUndulpUhxtks", slug: "my-organization" });
console.log("internal org id:", org.id);

const existing = await db
  .select()
  .from(departmentConfigs)
  .where(and(eq(departmentConfigs.orgId, org.id), eq(departmentConfigs.department, "sales-lead")));

if (existing[0]) {
  await db
    .update(departmentConfigs)
    .set({ enabled: true, autonomyLevel: "draft_only" })
    .where(eq(departmentConfigs.id, existing[0].id));
  console.log("updated existing department_configs row to draft_only");
} else {
  await db.insert(departmentConfigs).values({
    orgId: org.id,
    department: "sales-lead",
    enabled: true,
    autonomyLevel: "draft_only",
  });
  console.log("inserted department_configs row: sales-lead, draft_only, enabled");
}
