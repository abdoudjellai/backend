import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { handleWebhook, setupWebhook, getTelegramStatus } from "./telegram.controller.js";

/** Mounted at /api/v1/telegram. Webhook is public; management endpoints are authenticated. */
export function createTelegramRouter(): Router {
  const router = Router();
  router.post("/webhook", handleWebhook);
  router.post("/setup-webhook", authenticate, setupWebhook);
  router.get("/status", authenticate, getTelegramStatus);
  return router;
}
