import { afterEach, describe, expect, it, vi } from "vitest";
import { AigridProvider, AiProviderError, type AigridProviderConfig } from "../../src/modules/ai/providers/aigrid.provider.js";

const DEFAULT_CONFIG: AigridProviderConfig = {
  baseUrl: "https://api.aigrid.test/v1",
  apiKey: "test-key-123",
  model: "Qwen/Qwen3.8-27B",
};

function makeProvider(overrides: Partial<AigridProviderConfig> = {}): AigridProvider {
  return new AigridProvider({ ...DEFAULT_CONFIG, ...overrides });
}

function openAiResponse(content: string, model = "Qwen/Qwen3.8-27B") {
  return {
    choices: [{ message: { content, tool_calls: [] }, finish_reason: "stop" }],
    model,
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function toolCallResponse(toolCalls: { id: string; name: string; arguments: string }[], model = "Qwen/Qwen3.8-27B") {
  return {
    choices: [{
      message: {
        content: null,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
      },
      finish_reason: "tool_calls",
    }],
    model,
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

describe("AigridProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when baseUrl is missing", () => {
    expect(() => makeProvider({ baseUrl: "" })).toThrow(AiProviderError);
  });

  it("throws when apiKey is missing", () => {
    expect(() => makeProvider({ apiKey: "" })).toThrow(AiProviderError);
  });

  it("sends a correct chat completion request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(openAiResponse("Hello!")), { status: 200 }),
    );

    const provider = makeProvider();
    const result = await provider.complete({
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(result.content).toBe("Hello!");
    expect(result.toolCalls).toEqual([]);
    expect(result.model).toBe("Qwen/Qwen3.8-27B");
    expect(result.usage.totalTokens).toBe(15);
    expect(result.finishReason).toBe("stop");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.aigrid.test/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key-123");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("Qwen/Qwen3.8-27B");
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it("throws AiProviderError on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }),
    );

    const provider = makeProvider();
    await expect(provider.complete({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(AiProviderError);
  });

  it("throws AiProviderError on empty response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }),
    );

    const provider = makeProvider();
    await expect(provider.complete({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(
      "AI provider returned an empty response",
    );
  });

  it("throws AiProviderError on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const provider = makeProvider();
    await expect(provider.complete({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(AiProviderError);
  });

  it("testConnection returns ok:true on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(openAiResponse("OK")), { status: 200 }),
    );

    const provider = makeProvider();
    const result = await provider.testConnection();

    expect(result.ok).toBe(true);
    expect(result.model).toBe("Qwen/Qwen3.8-27B");
    expect(result.message).toBe("OK");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("testConnection returns ok:false on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const provider = makeProvider();
    const result = await provider.testConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("fetch failed");
  });

  it("parses native tool calls from the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(toolCallResponse([
        { id: "call_1", name: "search_products", arguments: '{"query":"shoes"}' },
      ])), { status: 200 }),
    );

    const provider = makeProvider();
    const result = await provider.complete({
      messages: [{ role: "user", content: "Show me shoes" }],
      tools: [{
        type: "function",
        function: {
          name: "search_products",
          description: "Search products",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("search_products");
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({ query: "shoes" });
    expect(result.finishReason).toBe("tool_calls");
  });

  it("strips trailing slashes from base URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(openAiResponse("OK")), { status: 200 }),
    );

    const provider = makeProvider({ baseUrl: "https://api.aigrid.test/v1///" });
    await provider.complete({ messages: [{ role: "user", content: "Hi" }] });

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.aigrid.test/v1/chat/completions");
  });
});
