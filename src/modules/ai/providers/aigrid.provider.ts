import { logger } from "../../../config/logger.js";

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
}

export interface AiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AiToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiCompletionOptions {
  messages: AiMessage[];
  tools?: AiToolDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionResult {
  content: string | null;
  toolCalls: AiToolCall[];
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider: string = "aigrid",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AigridProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * AIGrid provider using the OpenAI-compatible chat completions API.
 * Stateless — every call is independent. The provider never stores API keys
 * or conversation state.
 */
export class AigridProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly model: string;

  constructor(config: AigridProviderConfig) {
    if (!config.baseUrl) {
      throw new AiProviderError("AI_BASE_URL is required");
    }
    if (!config.apiKey) {
      throw new AiProviderError("AI_API_KEY is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    };
    if (options.tools !== undefined && options.tools.length > 0) {
      body.tools = options.tools;
    }

    logger.debug({ model: this.model, messageCount: options.messages.length, tools: options.tools?.length ?? 0 }, "AI request");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AiProviderError("AI request timed out");
      }
      throw new AiProviderError(`AI request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore read errors on error responses
      }
      logger.error(
        { statusCode: response.status, errorBody: errorBody.slice(0, 500) },
        "AI provider returned an error",
      );
      throw new AiProviderError(
        `AI provider returned HTTP ${response.status}`,
        response.status,
      );
    }

    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: AiToolCall[];
        };
        finish_reason?: string;
      }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? null;
    const toolCalls = choice?.message?.tool_calls ?? [];
    const finishReason = choice?.finish_reason ?? "unknown";

    if (content === null && toolCalls.length === 0) {
      throw new AiProviderError("AI provider returned an empty response");
    }

    const result: AiCompletionResult = {
      content,
      toolCalls,
      model: typeof data.model === "string" ? data.model : this.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason,
    };

    logger.debug(
      { model: result.model, tokens: result.usage.totalTokens, finishReason: result.finishReason, toolCalls: toolCalls.length },
      "AI response received",
    );

    return result;
  }

  /** Quick connectivity and model availability check. */
  async testConnection(): Promise<{ ok: boolean; model: string; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await this.complete({
        messages: [
          { role: "system", content: "You are a test assistant. Reply with exactly: OK" },
          { role: "user", content: "ping" },
        ],
        temperature: 0,
        maxTokens: 10,
      });
      return {
        ok: true,
        model: result.model,
        message: (result.content ?? "").trim(),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        model: this.model,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
      };
    }
  }
}
