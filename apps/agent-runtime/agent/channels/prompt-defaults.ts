import { defineChannel, GET } from "eve/channels";
import { routeAuth, localDev, placeholderAuth } from "eve/channels/auth";
import { clerkOrgSession } from "../lib/clerk-org-auth";

import ROOT_DEFAULT from "../instructions.default";
import ENG_LEAD_DEFAULT from "../subagents/eng-lead/instructions.default";
import CODE_REVIEWER_DEFAULT from "../subagents/eng-lead/subagents/code-reviewer/instructions.default";
import PRODUCT_LEAD_DEFAULT from "../subagents/product-lead/instructions.default";
import RESEARCHER_DEFAULT from "../subagents/researcher/instructions.default";
import OPS_MANAGER_DEFAULT from "../subagents/ops-manager/instructions.default";
import DESIGN_LEAD_DEFAULT from "../subagents/design-lead/instructions.default";
import DATA_LEAD_DEFAULT from "../subagents/data-lead/instructions.default";
import SALES_LEAD_DEFAULT from "../subagents/sales-lead/instructions.default";
import SWE_LEAD_DEFAULT from "../subagents/swe-lead/instructions.default";
import BACKEND_DEVELOPER_DEFAULT from "../subagents/swe-lead/subagents/backend-developer/instructions.default";
import FRONTEND_DEVELOPER_DEFAULT from "../subagents/swe-lead/subagents/frontend-developer/instructions.default";
import UI_UX_DESIGNER_DEFAULT from "../subagents/swe-lead/subagents/ui-ux-designer/instructions.default";

/**
 * Every agentId's default instructions content, keyed the same way as
 * apps/web/app/dashboard/prompts/agents.ts's AGENT_PROMPTS[].id — that's
 * the id scheme readAgentPrompt() (apps/web/app/dashboard/prompts/
 * actions.ts) looks up against this route. Keep in sync with AGENT_PROMPTS
 * by hand, same as resolveInstructions() in agent/lib/resolve-instructions.ts
 * keeps its own agentId strings in sync with it.
 *
 * Plain static imports (not a filesystem walk) for the same reason the
 * instructions.default.ts files themselves exist as TS string constants
 * rather than instructions.md: this needs to bundle reliably into whatever
 * artifact actually ships to production, not depend on reading sibling
 * source files off disk at runtime — see instructions.default.ts's own
 * header comment.
 */
const DEFAULTS: Record<string, string> = {
  root: ROOT_DEFAULT,
  "eng-lead": ENG_LEAD_DEFAULT,
  "eng-lead/code-reviewer": CODE_REVIEWER_DEFAULT,
  "product-lead": PRODUCT_LEAD_DEFAULT,
  researcher: RESEARCHER_DEFAULT,
  "ops-manager": OPS_MANAGER_DEFAULT,
  "design-lead": DESIGN_LEAD_DEFAULT,
  "data-lead": DATA_LEAD_DEFAULT,
  "sales-lead": SALES_LEAD_DEFAULT,
  "swe-lead": SWE_LEAD_DEFAULT,
  "swe-lead/backend-developer": BACKEND_DEVELOPER_DEFAULT,
  "swe-lead/frontend-developer": FRONTEND_DEVELOPER_DEFAULT,
  "swe-lead/ui-ux-designer": UI_UX_DESIGNER_DEFAULT,
};

/**
 * Cross-container replacement for apps/web reading agent-runtime's
 * instructions.default.ts files directly off a shared local disk — that
 * assumption broke once web (ECS Fargate) and agent-runtime (ECS EC2)
 * became two separate containers with no shared filesystem (real 500,
 * `ENOENT .../instructions.default.ts`, confirmed 2026-08-06). Same
 * fetch-with-bearer-token shape apps/web already uses for this exact
 * cross-service boundary (see apps/web/lib/eve-client.ts,
 * apps/web/app/dashboard/run/actions.ts) — just a GET instead of a
 * session POST, and gated by the same clerkOrgSession() check as the
 * default eve channel, since only a signed-in org admin's own Clerk
 * token should be able to read this.
 */
export default defineChannel({
  routes: [
    // eve does not prefix custom-channel routes with the channel id (the
    // urlPath is registered globally, verbatim) — "prompt-defaults" is
    // baked into the literal path itself so it can't collide with another
    // channel's route. Must live under /eve/ specifically: the ALB in
    // front of these two separately-deployed containers only routes
    // /eve/* and /.well-known/workflow/* to agent-runtime, everything
    // else defaults to the web service — a bare /prompt-defaults/... path
    // would silently 404 (infra/lib/foundry-stack.ts's listener rules).
    GET("/eve/v1/prompt-defaults/:agentId", async (req, { params }) => {
      const auth = await routeAuth(req, [
        clerkOrgSession(),
        // Open on localhost for `eve dev` and the REPL; ignored in production.
        localDev(),
        ...(process.env.NODE_ENV !== "production" ? [placeholderAuth()] : []),
      ]);
      if (auth instanceof Response) return auth;

      const content = DEFAULTS[params.agentId];
      if (content === undefined) {
        return Response.json({ error: `Unknown agentId: ${params.agentId}` }, { status: 404 });
      }
      return Response.json({ content });
    }),
  ],
});
