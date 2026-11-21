import { logger } from "../../config/logger.js";
import type { AiMessage, AiToolCall, AiToolDef } from "./providers/aigrid.provider.js";
import { aiComplete } from "./ai.service.js";

export interface AgentLoopResult {
  reply: string;
  toolsUsed: string[];
}

export interface RunAgentLoopOptions {
  systemPrompt: string;
  messages: AiMessage[];
  tools: AiToolDef[];
  executeTool: (name: string, argsJson: string) => Promise<unknown>;
  maxRounds?: number;
  temperature?: number;
  maxTokens?: number;
  onToolResult?: (name: string, argsJson: string, result: unknown) => void;
}

const DEFAULT_MAX_ROUNDS = 5;

/**
 * Shared AI tool-calling loop. Each agent (customer, owner) supplies its own system prompt,
 * tool registry and executor; the provider call and iteration handling are identical.
 * Tool calls are bounded by maxRounds to avoid infinite loops.
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const toolsUsed: string[] = [];
  const messages: AiMessage[] = [
    { role: "system", content: options.systemPrompt },
    ...options.messages,
  ];

  for (let round = 0; round < maxRounds; round++) {
    const result = await aiComplete({
      messages,
      tools: options.tools.length > 0 ? options.tools : undefined,
      temperature: options.temperature ?? 0.5,
      maxTokens: options.maxTokens ?? 2048,
    });

    if (result.toolCalls.length === 0) {
      return { reply: result.content ?? "", toolsUsed };
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      const toolName = toolCall.function.name;
      toolsUsed.push(toolName);

      logger.debug({ toolName, round }, "AI agent invoking tool");

      const toolResult = await options.executeTool(toolName, toolCall.function.arguments);

      options.onToolResult?.(toolName, toolCall.function.arguments, toolResult);

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id,
      });
    }
  }

  return { reply: "", toolsUsed };
}

/** Parse a tool-call argument string; returns an error marker object on invalid JSON. */
export function parseToolArgs(argsJson: string): Record<string, unknown> | { error: string } {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "Invalid tool arguments" };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { error: "Invalid tool arguments" };
  }
}

export type { AiToolCall };
