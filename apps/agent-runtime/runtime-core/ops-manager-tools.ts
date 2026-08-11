import type { ToolDefinition } from "@foundry/agent-runtime-core";

// Reusing ops-manager's existing eve tool files unchanged — defineTool()
// (node_modules/eve/dist/src/public/definitions/tool.js) just does
// `Object.assign(e, {...brand})` and returns the same object, so each
// file's default export is already a plain
// `{ description, inputSchema, execute(input, ctx) }` object (plus an
// `approval` field on gated ones, which we ignore here — see
// guardrails-hook.ts for the replacement). No rewrite of any tool's
// business logic needed, confirmed by reading eve's actual source.
import getDailyOpsDigest from "../agent/subagents/ops-manager/tools/get_daily_ops_digest.js";
import getCompanyDigest from "../agent/subagents/ops-manager/tools/get_company_digest.js";
import getSetupChangelog from "../agent/subagents/ops-manager/tools/get_setup_changelog.js";
import listCalendarEvents from "../agent/subagents/ops-manager/tools/list_calendar_events.js";
import placeCall from "../agent/subagents/ops-manager/tools/place_call.js";
import getCallResult from "../agent/subagents/ops-manager/tools/get_call_result.js";
import postWebhook from "../agent/subagents/ops-manager/tools/post_webhook.js";
import remember from "../agent/subagents/ops-manager/tools/remember.js";
import recall from "../agent/subagents/ops-manager/tools/recall.js";
import forget from "../agent/subagents/ops-manager/tools/forget.js";

const RAW_TOOLS: Record<string, { description: string; inputSchema: any; execute: (input: any, ctx: any) => any }> = {
  get_daily_ops_digest: getDailyOpsDigest,
  get_company_digest: getCompanyDigest,
  get_setup_changelog: getSetupChangelog,
  list_calendar_events: listCalendarEvents,
  place_call: placeCall,
  get_call_result: getCallResult,
  post_webhook: postWebhook,
  remember,
  recall,
  forget,
};

export const opsManagerTools: ToolDefinition[] = Object.entries(RAW_TOOLS).map(([name, def]) => ({
  name,
  description: def.description,
  inputSchema: def.inputSchema,
  execute: def.execute,
}));
