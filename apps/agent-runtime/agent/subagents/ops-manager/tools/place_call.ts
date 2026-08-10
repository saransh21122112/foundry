import { defineTool } from "eve/tools";
import { z } from "zod";
import { makeApprovalPolicy } from "@foundry/guardrails";
import { dbDeps } from "@foundry/guardrails/deps-db";
import { createCall, pollCallResult } from "../../../lib/twilio-call";

/**
 * MVP scope, deliberately not a live two-way negotiation: this places the
 * call, speaks `message` once via TwiML <Say>, records+transcribes
 * whatever the other side says next, and returns that transcript — a
 * "leave a detailed ask, get back what they said" tool, not a real-time
 * conversational agent (that needs a Twilio Media Streams + STT/LLM/TTS
 * bridge, a separate and much larger subsystem, not built here).
 *
 * riskClass "financial" is one of guardrails' HARD_RULE_RISK_CLASSES (see
 * packages/guardrails/src/enforce.ts) — this always requires human approval
 * before dialing, at every autonomy level, enforced by existing code. A
 * real outbound call that can commit the org to something is exactly the
 * case that hard rule exists for.
 */
export default defineTool({
  description:
    "Place a real outbound phone call that speaks a message and records/transcribes the response. Use for things like calling a business to ask a question or make a request. This is NOT a live conversation — it speaks once, then listens and transcribes what comes back. Always requires human approval before dialing.",
  inputSchema: z.object({
    toNumber: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/, "must be E.164 format, e.g. +14155551234"),
    message: z.string().min(1).max(1000),
    maxWaitSeconds: z.number().int().min(10).max(90).default(60),
  }),
  approval: makeApprovalPolicy(
    {
      department: "ops-manager",
      riskClass: "financial",
      estimatedCost: { unit: "phone_calls", amount: 1 },
    },
    dbDeps,
  ),
  async execute({ toNumber, message, maxWaitSeconds }) {
    const callSid = await createCall(toNumber, message);
    const outcome = await pollCallResult(callSid, maxWaitSeconds * 1000);
    return outcome;
  },
});
