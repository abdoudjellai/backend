import { z } from "zod";
import { idParams, idSchema } from "../../shared/validation/common.js";

/** Longest accepted owner message, in characters. */
export const MAX_MESSAGE_LENGTH = 4000;
/** Cap on persisted messages per conversation (user + assistant), to keep storage bounded. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;
/** At most this many recent messages are sent to the model with each request... */
export const CONTEXT_WINDOW_MESSAGES = 20;
/** ...and at most this many characters of them (oldest dropped first). */
export const CONTEXT_WINDOW_CHARS = 16_000;
/** Earlier tool calls listed in the system prompt so follow-ups can reuse periods. */
export const RECENT_TOOL_CALLS_IN_PROMPT = 6;
/** Chat requests per owner per minute (each request can trigger several model calls). */
export const CHAT_RATE_LIMIT = { windowMs: 60 * 1000, limit: 20 } as const;

/**
 * Chat request body. Unknown keys (e.g. ownerId, storeId, businessId) are stripped: identity and
 * store always come from the authenticated session.
 */
export const chatBody = z.object({
  conversationId: idSchema.optional(),
  message: z.string().trim().min(1, "message is required").max(MAX_MESSAGE_LENGTH),
});
export type ChatBody = z.infer<typeof chatBody>;

export const conversationParams = idParams("conversationId");
