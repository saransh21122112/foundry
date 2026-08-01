import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/db and packages/guardrails ship raw TypeScript with no build
  // step (matches how eve consumes them too) — Next needs to know to
  // transpile them itself rather than treating them as pre-built JS.
  transpilePackages: ["@foundry/db", "@foundry/guardrails"],
  webpack(config) {
    // packages/db and packages/guardrails use NodeNext-style relative
    // imports ("./schema.js" pointing at schema.ts, per TS's own
    // convention for that module setting) — webpack needs to be told a
    // ".js" specifier may resolve to a ".ts" file on disk.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // TODO(Phase 1): once Clerk is wired up, add its recommended config here
  // (see node_modules/eve/docs and https://vercel.com skill "vercel:auth").
};

export default nextConfig;
