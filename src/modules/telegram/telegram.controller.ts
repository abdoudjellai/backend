import type { RequestHandler } from "express";
import { logger } from "../../config/logger.js";
import { validateWebhookSecret, type TelegramUpdate } from "./telegram.utils.js";
import { processTelegramUpdate } from "./telegram.service.js";

/**
 * POST /api/v1/telegram/webhook
 *
 * Receives Telegram updates. Responds 200 immediately and processes
 * the message asynchronously so Telegram doesn't retry.
 */
export const handleWebhook: RequestHandler = (req, res) => {
  const secret = req.get("x-telegram-bot-api-secret-token");
  if (!validateWebhookSecret(secret)) {
    logger.warn("Telegram webhook request with invalid secret — rejected");
    res.status(403).json({ ok: false });
    return;
  }

  const update = req.body as TelegramUpdate;
  if (typeof update?.update_id !== "number") {
    res.status(400).json({ ok: false });
    return;
  }

  // Respond immediately — Telegram wants a fast ack.
  res.status(200).json({ ok: true });

  // Process asynchronously — errors are logged, never sent back to Telegram.
  processTelegramUpdate(update).catch((error) => {
    logger.error({ err: error, updateId: update.update_id }, "Unhandled error in Telegram update processing");
  });
};
