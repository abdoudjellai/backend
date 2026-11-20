import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { storage } from "../../storage/index.js";
import { handleCustomerMessage } from "../ai/ai-agent.service.js";
import { isAiConfigured } from "../ai/ai.service.js";
import { sendTelegramMessage, sendTypingAction } from "./telegram.client.js";
import { extractMessageInfo, UpdateDeduplicator, type TelegramUpdate } from "./telegram.utils.js";

const deduplicator = new UpdateDeduplicator();

/**
 * Process an incoming Telegram update. Called asynchronously after the webhook
 * has already responded 200 to Telegram.
 */
export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (deduplicator.isDuplicate(update.update_id)) {
    logger.debug({ updateId: update.update_id }, "Duplicate Telegram update — skipping");
    return;
  }

  const info = extractMessageInfo(update);
  if (info === null) {
    logger.debug({ updateId: update.update_id }, "Unsupported Telegram update type — ignoring");
    return;
  }

  const storeId = env.TELEGRAM_DEFAULT_STORE_ID;
  if (!storeId) {
    logger.error("TELEGRAM_DEFAULT_STORE_ID is not set — cannot process message");
    await sendTelegramMessage(
      info.chatId,
      "⚠️ The bot is not configured yet. Please contact the store owner.",
    );
    return;
  }

  const store = storage.stores.findById(storeId);
  if (store === undefined) {
    logger.error({ storeId }, "TELEGRAM_DEFAULT_STORE_ID references a non-existent store");
    await sendTelegramMessage(
      info.chatId,
      "⚠️ The bot is not configured correctly. Please contact the store owner.",
    );
    return;
  }

  if (!isAiConfigured()) {
    logger.error("AI provider is not configured — cannot process Telegram message");
    await sendTelegramMessage(
      info.chatId,
      "⚠️ The AI assistant is not available right now. Please try again later.",
    );
    return;
  }

  logger.info(
    { chatId: info.chatId, telegramUserId: info.telegramUserId, textLength: info.text.length },
    "Processing Telegram message",
  );

  // Show typing indicator while AI processes.
  await sendTypingAction(info.chatId);

  try {
    const response = await handleCustomerMessage(
      storeId,
      store.name,
      info.telegramUserId,
      info.text,
    );

    logger.info(
      { chatId: info.chatId, toolsUsed: response.toolsUsed, replyLength: response.reply.length },
      "AI agent responded",
    );

    await sendTelegramMessage(info.chatId, response.reply);
  } catch (error) {
    logger.error({ err: error, chatId: info.chatId }, "Failed to process Telegram message through AI");
    await sendTelegramMessage(
      info.chatId,
      "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى لاحقاً.\nSorry, an error occurred. Please try again later.",
    ).catch(() => undefined);
  }
}
