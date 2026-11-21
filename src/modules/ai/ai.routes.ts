import { Router } from "express";
import { getAiStatus } from "./ai.controller.js";
import { postAiChat, postAiChatReset } from "./ai-chat.controller.js";

/** Mounted at /api/v1/ai — authenticated. */
export function createAiRouter(): Router {
  const router = Router();
  router.get("/status", getAiStatus);
  router.post("/chat", postAiChat);
  router.post("/chat/reset", postAiChatReset);
  return router;
}
