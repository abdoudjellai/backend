import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Validate the Telegram webhook secret.
 * Returns true if the header matches the configured secret.
 */
export function validateWebhookSecret(headerValue: string | undefined): boolean {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("TELEGRAM_WEBHOOK_SECRET is not set — webhook validation is disabled");
    return true;
  }
  return headerValue === secret;
}

/** Telegram Update object — only the fields we use. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    contact?: {
      phone_number: string;
      first_name: string;
      last_name?: string;
      user_id?: number;
    };
  };
}

/** Extract the useful fields from a Telegram update, or null if unsupported. */
export function extractMessageInfo(update: TelegramUpdate): {
  chatId: number;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  messageId: number;
  text: string;
} | null {
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.from.is_bot) return null;
  if (msg.chat.type !== "private") return null;

  return {
    chatId: msg.chat.id,
    telegramUserId: String(msg.from.id),
    username: msg.from.username ?? null,
    firstName: msg.from.first_name,
    messageId: msg.message_id,
    text: msg.text,
  };
}

/**
 * Simple deduplication for Telegram update IDs.
 * Keeps recent IDs in a bounded set.
 */
export class UpdateDeduplicator {
  private readonly seen = new Set<number>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /** Returns true if this update ID was already seen (duplicate). */
  isDuplicate(updateId: number): boolean {
    if (this.seen.has(updateId)) return true;
    this.seen.add(updateId);
    if (this.seen.size > this.maxSize) {
      // Remove the oldest entries (smallest IDs, since update_id is monotonically increasing).
      const sorted = [...this.seen].sort((a, b) => a - b);
      const toRemove = sorted.slice(0, sorted.length - this.maxSize + Math.floor(this.maxSize * 0.2));
      for (const id of toRemove) this.seen.delete(id);
    }
    return false;
  }

  get size(): number {
    return this.seen.size;
  }
}
