import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth } from "eve/channels/auth";
import { clerkOrgSession } from "../lib/clerk-org-auth";

export default eveChannel({
  auth: [
    clerkOrgSession(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // clerkOrgSession() above is real and live (verified 2026-07-29) —
    // this is defense-in-depth, not a to-do. Gated to non-production only:
    // placeholderAuth() itself throws when VERCEL_ENV === "production" and
    // otherwise just returns null (verified against eve's own source), so
    // this gate doesn't change behavior on AWS today — it exists so the
    // deny-by-production intent is explicit in this file, not dependent on
    // a Vercel-specific env var + a library internal an unfamiliar reader
    // would have to go verify themselves.
    ...(process.env.NODE_ENV !== "production" ? [placeholderAuth()] : []),
  ],
});
