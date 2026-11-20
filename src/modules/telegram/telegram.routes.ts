import { Router } from "express";
import { handleWebhook } from "./telegram.controller.js";

/** Mounted at /api/v1/telegram — public (Telegram sends webhooks without auth). */
export function createTelegramRouter(): Router {
  const router = Router();
  router.post("/webhook", handleWebhook);
  return router;
}
