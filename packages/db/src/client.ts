import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { RDS_CA_BUNDLE } from "./rds-ca-bundle.js";

// DATABASE_URL (local dev) or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
// (ECS — RDS's auto-generated Secrets Manager entry has no single
// connection-string field, only discrete fields) points at RDS Postgres.
// Reading this file / importing `db` before either is set throws at call
// time, not at import time, so packages/guardrails can still be
// unit-tested against fakes without a live database.
let pool: Pool | undefined;
function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url && !process.env.PGHOST) {
    throw new Error(
      "DATABASE_URL (or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD) is not set. " +
        "Provision RDS Postgres and set it before using @foundry/db's live client.",
    );
  }
  // RDS enforces SSL (pg_hba.conf rejects plaintext connections) — pg's
  // Pool doesn't enable it by default the way Neon's driver did. Validate
  // against AWS's actual RDS CA bundle rather than disabling verification.
  pool ??= url ? new Pool({ connectionString: url }) : new Pool({ ssl: { ca: RDS_CA_BUNDLE } });
  return drizzle(pool, { schema });
}

export const client = { getDb };
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});
