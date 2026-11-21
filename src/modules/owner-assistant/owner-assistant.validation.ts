import { z } from "zod";
import { idParams } from "../../shared/validation/common.js";

export const chatBody = z.looseObject({
  conversationId: z.string().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(4000),
});
export type ChatBody = z.infer<typeof chatBody>;

export const conversationParams = idParams("conversationId");

/** Cap on persisted messages per conversation, to keep files bounded. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;
/** How many recent messages are loaded into each model request (tool messages are not persisted). */
export const CONTEXT_WINDOW_MESSAGES = 20;
