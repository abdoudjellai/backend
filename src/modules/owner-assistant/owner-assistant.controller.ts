import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getAuth } from "../../shared/utils/request-context.js";
import { chatBody, conversationParams } from "./owner-assistant.validation.js";
import { chat, listConversations, getConversation, deleteConversation } from "./owner-assistant.service.js";

/**
 * POST /api/v1/owner-assistant/chat
 * Body: { conversationId?: string, message: string }
 */
export const postChat: RequestHandler = async (req, res) => {
  const body = chatBody.parse(req.body);
  const auth = getAuth(req);
  const result = await chat(auth, body.conversationId, body.message);
  sendSuccess(req, res, {
    conversationId: result.conversationId,
    message: result.message,
    toolsUsed: result.toolsUsed,
  });
};

/** GET /api/v1/owner-assistant/conversations */
export const getConversations: RequestHandler = (req, res) => {
  const auth = getAuth(req);
  sendSuccess(req, res, { conversations: listConversations(auth.ownerId) });
};

/** GET /api/v1/owner-assistant/conversations/:conversationId */
export const getConversationHandler: RequestHandler = async (req, res) => {
  const { conversationId } = conversationParams.parse(req.params);
  const auth = getAuth(req);
  const result = await getConversation(auth.ownerId, conversationId);
  sendSuccess(req, res, { conversation: result.conversation, messages: result.messages });
};

/** DELETE /api/v1/owner-assistant/conversations/:conversationId */
export const deleteConversationHandler: RequestHandler = async (req, res) => {
  const { conversationId } = conversationParams.parse(req.params);
  const auth = getAuth(req);
  await deleteConversation(auth.ownerId, conversationId);
  sendSuccess(req, res, { deleted: true });
};
