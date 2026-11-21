import { Router } from "express";
import { postChat, getConversations, getConversationHandler, deleteConversationHandler } from "./owner-assistant.controller.js";

/** Mounted at /api/v1/owner-assistant — authenticated. */
export function createOwnerAssistantRouter(): Router {
  const router = Router();
  router.post("/chat", postChat);
  router.get("/conversations", getConversations);
  router.get("/conversations/:conversationId", getConversationHandler);
  router.delete("/conversations/:conversationId", deleteConversationHandler);
  return router;
}
