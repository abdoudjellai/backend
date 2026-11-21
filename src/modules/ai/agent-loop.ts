import { logger } from "../../config/logger.js";
import type { AiMessage, AiToolCall, AiToolDef } from "./providers/aigrid.provider.js";
import { aiComplete } from "./ai.service.js";

/** One tool invocation made during a loop run (arguments as sent by the model, result status). */
export interface ToolCallRecord {
  name: string;
  arguments: string;
  /** False when the call was rejected (unknown tool, over budget) or the result carried an `error`. */
  ok: boolean;
}

export interface AgentLoopResult {
  reply: string;
  /** Names of tools invoked, in order (including rejected calls). Kept for existing callers. */
  toolsUsed: string[];
  toolCalls: ToolCallRecord[];
  /** True when the tool budget ran out and the final answer was forced without tools. */
  toolBudgetExhausted: boolean;
}

export interface RunAgentLoopOptions {
  systemPrompt: string;
  messages: AiMessage[];
  /** The only tools the model may call. Calls to any other name are rejected, never executed. */
  tools: AiToolDef[];
  executeTool: (name: string, argsJson: string) => Promise<unknown>;
  /** Model rounds that may request tools. One extra tool-free round is always allowed for the answer. */
  maxRounds?: number;
  /** Tool calls executed per model round; extra calls in the same round are rejected. */
  maxToolCallsPerRound?: number;
  /** Tool calls executed per run, across all rounds. */
  maxToolCalls?: number;
  temperature?: number;
  maxTokens?: number;
  onToolResult?: (name: string, argsJson: string, result: unknown) => void;
  /**
   * Optional check of a final reply. Return a notice to reject the reply once: the notice is sent
   * to the model (as a user-role message) and the loop continues, with tools still available.
   * Used by the owner assistant to catch figures stated without retrieving data.
   */
  checkReply?: (reply: string, toolCalls: readonly ToolCallRecord[]) => string | null;
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 6;
const DEFAULT_MAX_TOOL_CALLS = 12;

/**
 * Sent (as a user-role notice, which every chat template accepts mid-conversation) when the tool
 * budget is exhausted, so the model answers with what it already has instead of looping.
 */
const BUDGET_EXHAUSTED_NOTICE =
  "(System notice: the data-retrieval limit for this request has been reached. Answer now using only the data already retrieved. If something could not be retrieved, say so plainly.)";

/**
 * Shared AI tool-calling loop. Each agent (customer, owner) supplies its own system prompt,
 * tool registry and executor; the provider call and iteration handling are identical.
 *
 * Safety properties:
 * - Only tools listed in `options.tools` are executed; anything else gets an error result.
 * - Tool calls are bounded per round and per run; the run always ends with a tool-free answer.
 * - Tool executor failures become error results for the model, never thrown out of the loop.
 * - Reasoning blocks (`<think>…</think>`, emitted by Qwen3-family models) are stripped from replies.
 *
 * Provider errors (`AiProviderError`) are not caught here — callers decide how to report them.
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxPerRound = options.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS_PER_ROUND;
  const maxTotal = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const allowed = new Set(options.tools.map((tool) => tool.function.name));
  const temperature = options.temperature ?? 0.5;
  const maxTokens = options.maxTokens ?? 2048;

  const toolCalls: ToolCallRecord[] = [];
  let executed = 0;
  let replyChecked = false;
  const messages: AiMessage[] = [{ role: "system", content: options.systemPrompt }, ...options.messages];

  for (let round = 0; round < maxRounds; round++) {
    const result = await aiComplete({
      messages,
      tools: options.tools.length > 0 ? options.tools : undefined,
      temperature,
      maxTokens,
    });

    const calls = result.toolCalls.map((call, index) => normalizeToolCall(call, round, index));
    if (calls.length === 0) {
      const reply = stripReasoning(result.content);
      const notice = replyChecked || options.checkReply === undefined ? null : options.checkReply(reply, toolCalls);
      if (notice === null) return finish(reply, toolCalls, false);
      // Rejected once: let the model see its draft and the notice, then try again with tools.
      replyChecked = true;
      logger.info({ round }, "AI reply rejected by checkReply; asking the model to retrieve data");
      messages.push({ role: "assistant", content: reply }, { role: "user", content: notice });
      continue;
    }

    messages.push({ role: "assistant", content: result.content, tool_calls: calls });

    for (const [index, call] of calls.entries()) {
      const name = call.function.name;
      const argsJson = call.function.arguments;
      let toolResult: unknown;

      if (!allowed.has(name)) {
        logger.warn({ toolName: name, round }, "AI requested a tool that is not in this agent's registry");
        toolResult = { error: "unknown_tool", message: `Tool "${name}" is not available.` };
      } else if (index >= maxPerRound || executed >= maxTotal) {
        toolResult = { error: "tool_limit_reached", message: "Too many data requests. Answer with the data already retrieved." };
      } else {
        executed += 1;
        logger.debug({ toolName: name, round }, "AI agent invoking tool");
        try {
          toolResult = await options.executeTool(name, argsJson);
        } catch (error) {
          logger.error({ err: error, toolName: name }, "Tool executor threw");
          toolResult = { error: "tool_failed", message: "The data could not be retrieved." };
        }
        options.onToolResult?.(name, argsJson, toolResult);
      }

      toolCalls.push({ name, arguments: argsJson, ok: !isErrorResult(toolResult) });
      messages.push({ role: "tool", content: JSON.stringify(toolResult ?? null), tool_call_id: call.id });
    }

    if (executed >= maxTotal) break;
  }

  // Tool budget exhausted: one final round without tools so the model must answer.
  logger.warn({ toolCalls: toolCalls.length }, "AI agent tool budget exhausted; forcing a final answer");
  messages.push({ role: "user", content: BUDGET_EXHAUSTED_NOTICE });
  const final = await aiComplete({ messages, temperature, maxTokens });
  return finish(stripReasoning(final.content), toolCalls, true);
}

function finish(reply: string, toolCalls: ToolCallRecord[], toolBudgetExhausted: boolean): AgentLoopResult {
  return { reply, toolsUsed: toolCalls.map((call) => call.name), toolCalls, toolBudgetExhausted };
}

function isErrorResult(result: unknown): boolean {
  return typeof result === "object" && result !== null && "error" in result;
}

/**
 * Providers are not always strict about the OpenAI shape: IDs can be missing and `arguments` can
 * arrive as an object. Normalize so every call can be answered with a matching `tool_call_id`.
 */
function normalizeToolCall(call: unknown, round: number, index: number): AiToolCall {
  const raw = (typeof call === "object" && call !== null ? call : {}) as {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `call_${round}_${index}`;
  const name = typeof raw.function?.name === "string" ? raw.function.name : "";
  const args = raw.function?.arguments;
  const argumentsJson =
    typeof args === "string" ? args : args === undefined || args === null ? "{}" : JSON.stringify(args);
  return { id, type: "function", function: { name, arguments: argumentsJson } };
}

/**
 * Remove model reasoning from a reply. Handles complete `<think>…</think>` blocks, a dangling
 * closing tag (templates that pre-open the block), and an unterminated opening block.
 */
export function stripReasoning(content: string | null): string {
  if (content === null) return "";
  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = text.toLowerCase().lastIndexOf("</think>");
  if (close !== -1) text = text.slice(close + "</think>".length);
  const open = text.toLowerCase().indexOf("<think>");
  if (open !== -1) text = text.slice(0, open);
  return text.trim();
}

/** Parse a tool-call argument string; returns an error marker object on invalid JSON. */
export function parseToolArgs(argsJson: string): Record<string, unknown> | { error: string } {
  if (argsJson.trim() === "") return {};
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
