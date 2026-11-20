import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";

const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MESSAGE_LENGTH = 4096;

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function getBotToken(): string {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramApiError("TELEGRAM_BOT_TOKEN is not configured");
  }
  return env.TELEGRAM_BOT_TOKEN;
}

async function telegramRequest(method: string, body: Record<string, unknown>): Promise<unknown> {
  const token = getBotToken();
  const url = `${TELEGRAM_API}/bot${token}/${method}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TelegramApiError("Telegram API request timed out");
    }
    throw new TelegramApiError(`Telegram API request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json()) as { ok: boolean; description?: string; result?: unknown };

  if (!data.ok) {
    logger.error({ method, statusCode: response.status, description: data.description }, "Telegram API error");
    throw new TelegramApiError(
      `Telegram API ${method} failed: ${data.description ?? "unknown error"}`,
      response.status,
    );
  }

  return data.result;
}

/** Send a text message to a Telegram chat. Splits long messages. */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  if (text.length === 0) return;

  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
    });
  }
}

/** Send a typing indicator. */
export async function sendTypingAction(chatId: number | string): Promise<void> {
  try {
    await telegramRequest("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    // Non-critical — don't fail the flow if typing indicator fails.
  }
}

/** Get bot info to verify the token is valid. */
export async function getMe(): Promise<{ id: number; first_name: string; username?: string }> {
  return (await telegramRequest("getMe", {})) as { id: number; first_name: string; username?: string };
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit.
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      // No good newline — split at a space.
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // No good space either — hard split.
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
