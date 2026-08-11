import { generateText, tool, type LanguageModel } from "ai";
import type {
  AgentMessage,
  BeforeToolCallHook,
  RunContext,
  ToolDefinition,
} from "./types.js";

export interface AgentLoopOptions {
  model: LanguageModel;
  system: string;
  tools: ToolDefinition[];
  ctx: RunContext;
  beforeToolCall: BeforeToolCallHook;
  /** Conversation so far, including the new user turn — the loop appends to and returns this. */
  messages: AgentMessage[];
  /** Safety valve against a runaway tool-call loop — not currently configurable per department, just a sane default. */
  maxSteps?: number;
}

export type AgentLoopEvent =
  | { type: "message.completed"; text: string }
  | { type: "action.result"; toolName: string; output: unknown }
  | { type: "turn.completed" };

/**
 * The OpenClaw-modeled core: a plain while loop, not a state machine.
 * Each iteration asks the model for one step (stopWhen defaults to a
 * single step in the `ai` SDK), inspects any tool calls it made, runs
 * `beforeToolCall` per call (guardrails plugs in here), executes what's
 * not blocked, appends results, and loops until the model stops asking
 * for tools.
 */
export async function* runAgentLoop(
  options: AgentLoopOptions,
): AsyncGenerator<AgentLoopEvent, AgentMessage[]> {
  const { model, system, tools, ctx, beforeToolCall, maxSteps = 25 } = options;

  const toolSet = Object.fromEntries(
    tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.inputSchema })]),
  );
  const byName = new Map(tools.map((t) => [t.name, t]));

  const messages: AgentMessage[] = options.messages;

  for (let step = 0; step < maxSteps; step++) {
    const result = await generateText({ model, system, messages, tools: toolSet });

    if (result.text) {
      yield { type: "message.completed", text: result.text };
    }
    messages.push(...result.response.messages);

    if (result.toolCalls.length === 0) {
      yield { type: "turn.completed" };
      return messages;
    }

    for (const call of result.toolCalls) {
      const toolDef = byName.get(call.toolName);
      if (!toolDef) {
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: "error-text", value: `Unknown tool: ${call.toolName}` },
            },
          ],
        });
        continue;
      }

      const decision = await beforeToolCall({
        toolCallId: call.toolCallId,
        name: call.toolName,
        input: call.input,
      });

      if (decision.block) {
        const output = { blocked: true, reason: decision.reason ?? "blocked" };
        yield { type: "action.result", toolName: call.toolName, output };
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: "json", value: output },
            },
          ],
        });
        continue;
      }

      let output: unknown;
      try {
        output = await toolDef.execute(call.input as never, ctx);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      yield { type: "action.result", toolName: call.toolName, output };
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "json", value: output as never },
          },
        ],
      });
    }
  }

  yield { type: "turn.completed" };
  return messages;
}
