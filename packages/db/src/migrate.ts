import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RDS_CA_BUNDLE } from "./rds-ca-bundle.js";

/**
 * One-off migration runner — applies packages/db/migrations/*.sql against
 * whatever PGHOST/etc (or DATABASE_URL) is in the environment. Not part of
 * the app's normal startup path; run manually (locally against Neon, or as
 * a one-off ECS task against RDS, since RDS sits in a private subnet with
 * no route from outside the VPC).
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const pool = url ? new Pool({ connectionString: url }) : new Pool({ ssl: { ca: RDS_CA_BUNDLE } });
  const db = drizzle(pool);
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  console.log(`Applying migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
