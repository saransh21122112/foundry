import { defineTool } from "eve/tools";
import { z } from "zod";
import { pollCallResult } from "../../../lib/twilio-call";

/**
 * Sibling to place_call.ts for the case where that tool returned
 * `{status: "in_progress"}` because the call/transcription wasn't done
 * within its own maxWaitSeconds — a pure read of an already-placed call
 * (no new dialing, no new side effect), so unlike place_call this is
 * ungated, same convention as get_company_digest.ts.
 */
export default defineTool({
  description:
    "Check on a phone call placed earlier with place_call, by its callSid — use this if place_call returned status 'in_progress' and you want to check whether it finished.",
  inputSchema: z.object({
    callSid: z.string().min(1),
    maxWaitSeconds: z.number().int().min(1).max(90).default(20),
  }),
  async execute({ callSid, maxWaitSeconds }) {
    return pollCallResult(callSid, maxWaitSeconds * 1000);
  },
});
