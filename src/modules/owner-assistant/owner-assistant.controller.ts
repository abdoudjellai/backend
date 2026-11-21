import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getAuth } from "../../shared/utils/request-context.js";
import { chatBody, conversationParams, listConversationsQuery } from "./owner-assistant.validation.js";
import { chat, listConversations, getConversation, deleteConversation } from "./owner-assistant.service.js";

/**
 * POST /api/v1/owner-assistant/chat
 * Body: { conversationId?: string, message: string }. 201 when a conversation was created.
 */
export const postChat: RequestHandler = async (req, res) => {
  const body = chatBody.parse(req.body);
  const result = await chat(getAuth(req), body.conversationId, body.message, new Date(), body.storeId);
  sendSuccess(
    req,
    res,
    { conversationId: result.conversationId, createdConversation: result.createdConversation, message: result.message, toolsUsed: result.toolsUsed },
    result.createdConversation ? 201 : 200,
  );
};

/** GET /api/v1/owner-assistant/conversations?storeId= — newest activity first. */
export const getConversations: RequestHandler = (req, res) => {
  const { storeId } = listConversationsQuery.parse(req.query);
  sendSuccess(req, res, { conversations: listConversations(getAuth(req).ownerId, storeId) });
};

/** GET /api/v1/owner-assistant/conversations/:conversationId — messages oldest first. */
export const getConversationHandler: RequestHandler = (req, res) => {
  const { conversationId } = conversationParams.parse(req.params);
  sendSuccess(req, res, getConversation(getAuth(req).ownerId, conversationId));
};

/** DELETE /api/v1/owner-assistant/conversations/:conversationId */
export const deleteConversationHandler: RequestHandler = async (req, res) => {
  const { conversationId } = conversationParams.parse(req.params);
  await deleteConversation(getAuth(req).ownerId, conversationId);
  sendSuccess(req, res, { deleted: true });
};
