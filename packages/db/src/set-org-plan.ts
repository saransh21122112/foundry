import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { organizations } from "./schema.js";
import { RDS_CA_BUNDLE } from "./rds-ca-bundle.js";

/**
 * One-off admin script — sets an org's plan directly, bypassing Stripe.
 * For the operator's own dogfooding org, not customer-facing. Same
 * one-off-Fargate-task execution pattern as migrate.ts (RDS has no route
 * from outside the VPC). Confirmed via a prior list-only run there's
 * exactly one org (id=36fafe2a-2303-4fa6-a761-e2836a1f497a) before writing.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const pool = url ? new Pool({ connectionString: url }) : new Pool({ ssl: { ca: RDS_CA_BUNDLE } });
  const db = drizzle(pool);

  const orgId = "36fafe2a-2303-4fa6-a761-e2836a1f497a";
  await db.update(organizations).set({ plan: "pro" }).where(eq(organizations.id, orgId));

  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  console.log(`Updated org ${orgId}: plan=${row?.plan}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
