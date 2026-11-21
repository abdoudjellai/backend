import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiCompletionOptions, AiCompletionResult, AiToolDef } from "../../src/modules/ai/providers/aigrid.provider.js";

vi.mock("../../src/modules/ai/ai.service.js", () => ({ aiComplete: vi.fn() }));

const { aiComplete } = await import("../../src/modules/ai/ai.service.js");
const { runAgentLoop, stripReasoning } = await import("../../src/modules/ai/agent-loop.js");
const { AiProviderError } = await import("../../src/modules/ai/providers/aigrid.provider.js");

const mockComplete = vi.mocked(aiComplete);

const tool = (name: string): AiToolDef => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } });

function reply(content: string | null, toolCalls: unknown[] = []): AiCompletionResult {
  return {
    content,
    toolCalls: toolCalls as AiCompletionResult["toolCalls"],
    model: "test",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  };
}
const toolCall = (id: string, name: string, args = "{}") => ({ id, type: "function", function: { name, arguments: args } });

/** Messages sent on the nth provider call (snapshot — the loop mutates its array). */
const sent: AiCompletionOptions[] = [];

beforeEach(() => {
  sent.length = 0;
  mockComplete.mockReset();
});

function script(...responses: AiCompletionResult[]): void {
  for (const response of responses) {
    mockComplete.mockImplementationOnce(async (options) => {
      sent.push(structuredClone(options));
      return response;
    });
  }
}

const base = { systemPrompt: "SYSTEM", messages: [{ role: "user" as const, content: "hi" }], tools: [tool("get_stats")] };

describe("runAgentLoop", () => {
  it("returns a direct answer without tools", async () => {
    script(reply("Hello!"));
    const executeTool = vi.fn();
    const result = await runAgentLoop({ ...base, executeTool });
    expect(result).toEqual({ reply: "Hello!", toolsUsed: [], toolCalls: [], toolBudgetExhausted: false });
    expect(executeTool).not.toHaveBeenCalled();
    expect(sent[0]!.messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(sent[0]!.tools).toHaveLength(1);
  });

  it("executes a requested tool and feeds the result back with the matching call id", async () => {
    script(reply(null, [toolCall("call_a", "get_stats", '{"period":"this_month"}')]), reply("You had 4 orders."));
    const executeTool = vi.fn().mockResolvedValue({ totalOrders: 4 });
    const result = await runAgentLoop({ ...base, executeTool });
    expect(executeTool).toHaveBeenCalledWith("get_stats", '{"period":"this_month"}');
    expect(result.reply).toBe("You had 4 orders.");
    expect(result.toolCalls).toEqual([{ name: "get_stats", arguments: '{"period":"this_month"}', ok: true }]);
    const second = sent[1]!.messages;
    expect(second.at(-1)).toEqual({ role: "tool", content: '{"totalOrders":4}', tool_call_id: "call_a" });
  });

  it("never executes tools outside the agent's registry", async () => {
    script(reply(null, [toolCall("c1", "create_order")]), reply("I can't do that."));
    const executeTool = vi.fn();
    const result = await runAgentLoop({ ...base, executeTool });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([{ name: "create_order", arguments: "{}", ok: false }]);
    expect(JSON.parse(sent[1]!.messages.at(-1)!.content!)).toMatchObject({ error: "unknown_tool" });
  });

  it("normalizes tool calls with missing ids or object arguments", async () => {
    script(reply(null, [{ function: { name: "get_stats", arguments: { period: "today" } } }]), reply("Done"));
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    await runAgentLoop({ ...base, executeTool });
    expect(executeTool).toHaveBeenCalledWith("get_stats", '{"period":"today"}');
    const assistant = sent[1]!.messages.find((m) => m.role === "assistant")!;
    const id = assistant.tool_calls![0]!.id;
    expect(id).toBe("call_0_0");
    expect(sent[1]!.messages.at(-1)!.tool_call_id).toBe(id);
  });

  it("turns executor exceptions into error results instead of failing the request", async () => {
    script(reply(null, [toolCall("c1", "get_stats")]), reply("Sorry, the data is unavailable."));
    const result = await runAgentLoop({ ...base, executeTool: vi.fn().mockRejectedValue(new Error("disk on fire")) });
    expect(result.reply).toBe("Sorry, the data is unavailable.");
    expect(result.toolCalls[0]!.ok).toBe(false);
    expect(sent[1]!.messages.at(-1)!.content).not.toContain("disk on fire");
  });

  it("rejects calls beyond the per-round limit", async () => {
    script(reply(null, [toolCall("a", "get_stats"), toolCall("b", "get_stats"), toolCall("c", "get_stats")]), reply("ok"));
    const executeTool = vi.fn().mockResolvedValue({});
    const result = await runAgentLoop({ ...base, executeTool, maxToolCallsPerRound: 2 });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.toolCalls.map((c) => c.ok)).toEqual([true, true, false]);
  });

  it("forces a tool-free final answer when the model keeps requesting tools", async () => {
    script(
      reply(null, [toolCall("1", "get_stats")]),
      reply(null, [toolCall("2", "get_stats")]),
      reply(null, [toolCall("3", "get_stats")]),
      reply("Here is what I found."),
    );
    const result = await runAgentLoop({ ...base, executeTool: vi.fn().mockResolvedValue({}), maxRounds: 3 });
    expect(mockComplete).toHaveBeenCalledTimes(4);
    expect(sent[3]!.tools).toBeUndefined();
    expect(sent[3]!.messages.at(-1)!.content).toMatch(/data-retrieval limit/);
    expect(result).toMatchObject({ reply: "Here is what I found.", toolBudgetExhausted: true });
  });

  it("stops executing once the total tool budget is spent", async () => {
    script(reply(null, [toolCall("1", "get_stats"), toolCall("2", "get_stats")]), reply("Final"));
    const executeTool = vi.fn().mockResolvedValue({});
    const result = await runAgentLoop({ ...base, executeTool, maxToolCalls: 2 });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.toolBudgetExhausted).toBe(true);
    expect(sent[1]!.tools).toBeUndefined();
  });

  it("strips reasoning from the reply", async () => {
    script(reply("<think>The user wants revenue…</think>\nRevenue was 6,000 DZD."));
    expect((await runAgentLoop({ ...base, executeTool: vi.fn() })).reply).toBe("Revenue was 6,000 DZD.");
  });

  it("lets checkReply reject a reply once, then accepts the retry", async () => {
    script(reply("You had 10 orders."), reply(null, [toolCall("c1", "get_stats")]), reply("You had 4 orders."), reply("unused"));
    const checkReply = vi.fn((text: string, calls: readonly { ok: boolean }[]) => (calls.some((c) => c.ok) ? null : `REJECT:${text}`));
    const result = await runAgentLoop({ ...base, executeTool: vi.fn().mockResolvedValue({ totalOrders: 4 }), checkReply });
    expect(result.reply).toBe("You had 4 orders.");
    expect(mockComplete).toHaveBeenCalledTimes(3);
    const retry = sent[1]!.messages;
    expect(retry.slice(-2)).toEqual([
      { role: "assistant", content: "You had 10 orders." },
      { role: "user", content: "REJECT:You had 10 orders." },
    ]);
    expect(sent[1]!.tools).toHaveLength(1);
  });

  it("only rejects once, so a stubborn model cannot loop", async () => {
    script(reply("Draft 1"), reply("Draft 2"));
    const result = await runAgentLoop({ ...base, executeTool: vi.fn(), checkReply: () => "try again" });
    expect(result.reply).toBe("Draft 2");
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it("propagates provider errors to the caller", async () => {
    mockComplete.mockRejectedValueOnce(new AiProviderError("AI provider returned HTTP 500", 500));
    await expect(runAgentLoop({ ...base, executeTool: vi.fn() })).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("stripReasoning", () => {
  it("handles complete, pre-opened and unterminated reasoning blocks", () => {
    expect(stripReasoning(null)).toBe("");
    expect(stripReasoning("Plain answer")).toBe("Plain answer");
    expect(stripReasoning("<think>a</think>One<think>b</think> two")).toBe("One two");
    expect(stripReasoning("reasoning without opening tag</think>Answer")).toBe("Answer");
    expect(stripReasoning("Answer<think>never closed")).toBe("Answer");
    expect(stripReasoning("<think>only thinking")).toBe("");
  });
});
