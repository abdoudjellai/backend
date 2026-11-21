import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { ErrorCodes } from "../../shared/constants/error-codes.js";
import type { ApiFailure } from "../../shared/types/api.js";
import { getAuth } from "../../shared/utils/request-context.js";
import { postChat, getConversations, getConversationHandler, deleteConversationHandler } from "./owner-assistant.controller.js";
import { CHAT_RATE_LIMIT } from "./owner-assistant.validation.js";

/**
 * Mounted at /api/v1/owner-assistant behind `authenticate`. Built per app instance so each app
 * (and each test) gets its own rate-limit counters.
 */
export function createOwnerAssistantRouter(): Router {
  const router = Router();

  // Every chat request may trigger several paid model calls: limit per owner, not per IP.
  const chatLimiter = rateLimit({
    ...CHAT_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => getAuth(req).ownerId,
    handler: (req, res) => {
      const body: ApiFailure = {
        success: false,
        error: { code: ErrorCodes.RATE_LIMITED, message: "Too many assistant requests. Wait a moment and try again." },
        requestId: req.requestId,
      };
      res.status(429).json(body);
    },
  });

  router.post("/chat", chatLimiter, postChat);
  router.get("/conversations", getConversations);
  router.get("/conversations/:conversationId", getConversationHandler);
  router.delete("/conversations/:conversationId", deleteConversationHandler);
  return router;
}
