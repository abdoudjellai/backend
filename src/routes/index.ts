import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { createAiRouter } from "../modules/ai/ai.routes.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { storesRouter } from "../modules/stores/stores.routes.js";
import { createTelegramRouter } from "../modules/telegram/telegram.routes.js";

/**
 * Versioned API router, mounted at /api/v1.
 * - /auth: public login (rate limited) and /auth/me (authenticated)
 * - /ai: AI provider status (authenticated)
 * - /telegram: webhook (public, validated by secret header)
 * - /stores: everything else — authenticated; /stores/:storeId/* also checks store ownership
 */
export function createApiRouter(): Router {
  const router = Router();
  router.use("/auth", createAuthRouter());
  router.use("/ai", authenticate, createAiRouter());
  router.use("/telegram", createTelegramRouter());
  router.use("/stores", authenticate, storesRouter);
  return router;
}
