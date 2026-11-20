import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AigridProvider, AiProviderError, type AiCompletionOptions, type AiCompletionResult } from "./providers/aigrid.provider.js";

let provider: AigridProvider | null = null;

function getProvider(): AigridProvider {
  if (provider === null) {
    provider = new AigridProvider({
      baseUrl: env.AI_BASE_URL ?? "",
      apiKey: env.AI_API_KEY ?? "",
      model: env.AI_MODEL,
    });
  }
  return provider;
}

/** Check whether AI credentials are configured (does not test connectivity). */
export function isAiConfigured(): boolean {
  return Boolean(env.AI_BASE_URL && env.AI_API_KEY);
}

/** Send a chat completion request to the configured AI provider. */
export async function aiComplete(options: AiCompletionOptions): Promise<AiCompletionResult> {
  return getProvider().complete(options);
}

/** Test AI provider connectivity and model availability. */
export async function testAiConnection(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  latencyMs: number;
}> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      provider: env.AI_PROVIDER,
      model: env.AI_MODEL,
      message: "AI_BASE_URL and AI_API_KEY must be set",
      latencyMs: 0,
    };
  }
  const result = await getProvider().testConnection();
  logger.info(
    { ok: result.ok, model: result.model, latencyMs: result.latencyMs },
    result.ok ? "AI connection test passed" : "AI connection test failed",
  );
  return { ...result, provider: env.AI_PROVIDER };
}

export { AiProviderError };
export type { AiMessage, AiToolCall, AiToolDef, AiCompletionOptions, AiCompletionResult } from "./providers/aigrid.provider.js";
