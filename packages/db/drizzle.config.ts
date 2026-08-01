import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only read when actually generating/pushing against a live DB.
    url: process.env.DATABASE_URL ?? "postgres://placeholder",
  },
} satisfies Config;
