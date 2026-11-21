import type { Store } from "../stores/store.model.js";
import type { AuthContext } from "../../shared/types/api.js";
import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { runAgentLoop, parseToolArgs } from "../ai/agent-loop.js";
import { isAiConfigured } from "../ai/ai.service.js";
import { buildOwnerAssistantPrompt } from "./owner-assistant.prompt.js";
import { OWNER_TOOLS, executeOwnerTool, type OwnerToolContext } from "./owner-tools.js";
import { conversationTitle, type OwnerConversation, type OwnerMessage } from "./owner-assistant.model.js";
import { CONTEXT_WINDOW_MESSAGES, MAX_MESSAGES_PER_CONVERSATION } from "./owner-assistant.validation.js";
import type { AiMessage } from "../ai/providers/aigrid.provider.js";

/** The assistant targets the owner's first store (deterministic; the dashboard follows the same rule). */
export function storeForOwner(ownerId: string): Store {
  const store = storage.stores
    .findAll((s) => s.ownerId === ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (store === undefined) {
    throw AppError.businessRule("No store found. Create a store first.");
  }
  return store;
}

export function listConversations(ownerId: string): OwnerConversation[] {
  return storage.ownerConversations
    .findAll((c) => c.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Returns the conversation and its messages (oldest first). Throws 404 for any other owner's ID. */
export async function getConversation(ownerId: string, conversationId: string): Promise<{ conversation: OwnerConversation; messages: OwnerMessage[] }> {
  const conversation = findOwnedConversation(ownerId, conversationId);
  const messages = storage.ownerMessages
    .findAll((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { conversation, messages };
}

export async function deleteConversation(ownerId: string, conversationId: string): Promise<void> {
  findOwnedConversation(ownerId, conversationId);
  await storage.ownerMessages.deleteWhere((m) => m.conversationId === conversationId);
  await storage.ownerConversations.delete(conversationId);
}

function findOwnedConversation(ownerId: string, conversationId: string): OwnerConversation {
  const conversation = storage.ownerConversations.findOne((c) => c.id === conversationId && c.ownerId === ownerId);
  if (conversation === undefined) {
    // 404 (not 403) so conversation IDs of other owners are not disclosed.
    throw AppError.notFound("Conversation not found");
  }
  return conversation;
}

export interface ChatResult {
  conversationId: string;
  message: { role: "assistant"; content: string };
  toolsUsed: string[];
  createdConversation: boolean;
}

export async function chat(auth: AuthContext, conversationId: string | undefined, message: string): Promise<ChatResult> {
  if (!isAiConfigured()) {
    throw AppError.businessRule("AI provider is not configured. Set AI_BASE_URL and AI_API_KEY.");
  }

  const store = storeForOwner(auth.ownerId);
  const createdConversation = conversationId === undefined;

  let conversation: OwnerConversation;
  if (createdConversation) {
    conversation = await storage.ownerConversations.create({
      ownerId: auth.ownerId,
      storeId: store.id,
      assistantType: "owner",
      title: conversationTitle(message),
    });
  } else {
    conversation = findOwnedConversation(auth.ownerId, conversationId);
    if (conversation.storeId !== store.id) {
      throw AppError.notFound("Conversation not found");
    }
  }

  await addMessage(conversation.id, store.id, "user", message);

  const history = storage.ownerMessages
    .findAll((m) => m.conversationId === conversation.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const context: AiMessage[] = history.slice(-CONTEXT_WINDOW_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolContext: OwnerToolContext = { storeId: store.id };
  const result = await runAgentLoop({
    systemPrompt: buildOwnerAssistantPrompt(store.name),
    messages: context,
    tools: OWNER_TOOLS,
    temperature: 0.3,
    maxTokens: 2048,
    executeTool: (name, argsJson) => executeOwnerTool(name, argsJson, toolContext),
  });

  const reply =
    result.reply ||
    "Sorry, I could not process that request. Please try again. / عذراً، لم أتمكن من معالجة الطلب. حاول مرة أخرى.";

  await addMessage(conversation.id, store.id, "assistant", reply);

  return {
    conversationId: conversation.id,
    message: { role: "assistant", content: reply },
    toolsUsed: result.toolsUsed,
    createdConversation,
  };
}

async function addMessage(conversationId: string, storeId: string, role: "user" | "assistant", content: string): Promise<void> {
  const count = storage.ownerMessages.count((m) => m.conversationId === conversationId);
  if (count >= MAX_MESSAGES_PER_CONVERSATION) {
    throw AppError.businessRule("This conversation has reached its message limit. Start a new conversation.");
  }
  await storage.ownerMessages.create({ conversationId, storeId, role, content });
  // A no-op update refreshes the conversation's updatedAt (managed by the storage layer).
  await storage.ownerConversations.update(conversationId, {});
}

export { parseToolArgs };
