import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateWebhookSecret, type TelegramUpdate } from "./telegram.utils.js";
import { processTelegramUpdate } from "./telegram.service.js";
import { getMe, setWebhook, getWebhookInfo } from "./telegram.client.js";

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

  res.status(200).json({ ok: true });

  processTelegramUpdate(update).catch((error) => {
    logger.error({ err: error, updateId: update.update_id }, "Unhandled error in Telegram update processing");
  });
};

/**
 * POST /api/v1/telegram/setup-webhook
 * Authenticated — registers the webhook URL with Telegram.
 */
export const setupWebhook: RequestHandler = async (req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw AppError.businessRule("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : env.API_BASE_URL;
  const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1/telegram/webhook`;

  await setWebhook(webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
  logger.info({ webhookUrl }, "Telegram webhook registered");

  sendSuccess(req, res, { webhookUrl, message: "Webhook registered successfully." });
};

/**
 * GET /api/v1/telegram/status
 * Authenticated — returns bot info and webhook status.
 */
export const getTelegramStatus: RequestHandler = async (req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    sendSuccess(req, res, { configured: false, message: "TELEGRAM_BOT_TOKEN is not set." });
    return;
  }

  try {
    const [bot, webhook] = await Promise.all([getMe(), getWebhookInfo()]);
    sendSuccess(req, res, {
      configured: true,
      bot: { id: bot.id, name: bot.first_name, username: bot.username ?? null },
      webhook: { url: webhook.url || null, pendingUpdates: webhook.pending_update_count },
      defaultStoreId: env.TELEGRAM_DEFAULT_STORE_ID ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendSuccess(req, res, { configured: true, error: message });
  }
};
