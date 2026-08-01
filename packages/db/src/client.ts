import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

// Not provisioned yet — DATABASE_URL needs a real Neon connection string
// (Saransh's Vercel Marketplace account, Phase 1). Reading this file /
// importing `db` before that's set throws at call time, not at import time,
// so packages/guardrails can still be unit-tested against fakes without a
// live database.
function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon Postgres (Vercel Marketplace) " +
        "and set DATABASE_URL before using @foundry/db's live client.",
    );
  }
  return drizzle(neon(url), { schema });
}

export const client = { getDb };
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});
