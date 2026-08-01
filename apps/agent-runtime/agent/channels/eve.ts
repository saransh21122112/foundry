import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import type { AuthFn } from "eve/channels/auth";
import { verifyToken } from "@clerk/backend";
import { ensureOrganization } from "@foundry/db";

/**
 * Resolves the caller's Clerk session (Bearer JWT) into
 * `attributes.orgId` — the tenant key every downstream tool/approval
 * policy reads via `ctx.session.auth.current.attributes.orgId` (see
 * packages/guardrails/src/eve-adapter.ts). No org on the token = no
 * tenant-scoped work; skip to the next auth entry rather than guessing.
 *
 * `attributes.orgId` here is deliberately our internal `organizations.id`
 * (uuid), NOT the raw Clerk `org_id` claim (`org_xxx`) — every guardrails
 * table foreign-keys against the former. `ensureOrganization()` (packages/
 * db/src/orgs.ts) is the one place that conversion happens, lazily
 * creating the `organizations` row on a tenant's first authenticated
 * request rather than requiring a separate provisioning webhook.
 *
 * Verified live end-to-end (2026-07-29, real signed-in session + real
 * gated tool call): `verifyToken` resolves real JWTs against this Clerk
 * instance's secret key. First live run surfaced a real bug — this Clerk
 * instance issues the newer `v: 2` compact token format, where org info
 * lives under `claims.o.{id,slg,rol}`, not the flat `org_id`/`org_slug`/
 * `org_role` fields (those are typed `never` on `v: 2` tokens — see
 * `@clerk/shared`'s `VersionedJwtPayload`). Reading only the flat fields
 * meant `claims.org_id` was always `undefined` for this instance, so
 * `enforce()` correctly denied every gated call with `no_org_on_session`
 * — confirmed live via a real `send_email` attempt that got blocked for
 * exactly that reason. Handles both token versions now.
 *
 * The `ensureOrganization` call adds one DB round-trip to every first
 * request per org per process lifetime in the common case (cache-miss on
 * brand new orgs only) — acceptable for now, revisit if route-auth
 * latency ever matters more than it does at this stage.
 */
function clerkOrgSession(): AuthFn<Request> {
  return async (request) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    try {
      const claims = await verifyToken(authHeader.slice("Bearer ".length), { secretKey });
      const orgId = claims.v === 2 ? claims.o?.id : claims.org_id;
      const orgRole = claims.v === 2 ? claims.o?.rol : claims.org_role;
      if (!orgId) return null; // signed in, but no active org — no tenant to scope to

      const org = await ensureOrganization({ clerkOrgId: orgId, slug: claims.v === 2 ? claims.o?.slg : claims.org_slug });
      return {
        authenticator: "app",
        principalId: claims.sub,
        principalType: "user",
        attributes: { orgId: org.id, orgRole: orgRole ?? "" },
      };
    } catch {
      return null; // invalid/expired token — fall through, don't throw for an unrecognized caller
    }
  };
}

export default eveChannel({
  auth: [
    clerkOrgSession(),
    // Lets the eve TUI and Vercel-to-Vercel callers reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Placeholder — does not allow browser requests in production. Remove
    // once clerkOrgSession() above is real; keeping both active at once
    // would let unauthenticated traffic through.
    placeholderAuth(),
  ],
});
