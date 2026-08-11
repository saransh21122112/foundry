import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest, NextFetchEvent } from "next/server";

const runClerkMiddleware = clerkMiddleware();

/**
 * CloudFront sits in front of a plain-HTTP-only ALB (no ACM cert — see
 * infra/lib/foundry-stack.ts's Cdn construct). The standard
 * `x-forwarded-proto` header is not usable to detect "was this originally
 * an HTTPS request": CloudFront sets it correctly, but the ALB then
 * overwrites it with its own listener's protocol (always "http", since
 * this ALB has no HTTPS listener). Without this fix, Clerk's own
 * server-side middleware believes every request is plain HTTP and builds
 * its handshake redirect_url as http://..., which can't carry the
 * Secure, SameSite=None cookie it just set — confirmed live as the cause
 * of sign-in never completing even after CloudFront was added.
 *
 * `x-foundry-forwarded-proto` is a CloudFront origin custom header (see
 * the CDK construct) that survives the ALB hop untouched, since the ALB
 * only rewrites its own well-known X-Forwarded-* headers. Promoting it
 * here, before Clerk's middleware runs, fixes this for every route at
 * once instead of patching each one.
 */
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.headers.get("x-foundry-forwarded-proto") === "https") {
    req.headers.set("x-forwarded-proto", "https");
  }
  return runClerkMiddleware(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, always run for API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
