import type { ModelMessage } from "ai";
import type { z } from "zod";

/**
 * A tool the agent loop can call. Deliberately close to eve's own
 * `defineTool()` output shape (description/inputSchema/execute) so
 * existing department tool files — written against eve — can be reused
 * with only a thin adapter, not a rewrite. `ctx` is ours, not eve's, but
 * exposes the one field every existing tool's `execute(input, ctx)` reads:
 * `ctx.session.auth.current.attributes.orgId`.
 */
export interface RunContext {
  session: {
    auth: {
      current?: { attributes?: { orgId?: string } } | null;
    };
  };
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput, ctx: RunContext) => Promise<TOutput>;
}

/** Plain chat history entry the loop accumulates. Re-exports the `ai` SDK's own message type — no reason to invent a parallel one. */
export type AgentMessage = ModelMessage;

export interface ToolCallAttempt {
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface BeforeToolCallResult {
  block: boolean;
  reason?: string;
}

export type BeforeToolCallHook = (toolCall: ToolCallAttempt) => Promise<BeforeToolCallResult>;
