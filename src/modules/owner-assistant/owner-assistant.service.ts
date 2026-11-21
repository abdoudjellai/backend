import { logger } from "../../config/logger.js";
import type { Store } from "../stores/store.model.js";
import type { AuthContext } from "../../shared/types/api.js";
import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { runAgentLoop, parseToolArgs, type ToolCallRecord } from "../ai/agent-loop.js";
import { isAiConfigured, AiProviderError } from "../ai/ai.service.js";
import type { AiMessage } from "../ai/providers/aigrid.provider.js";
import { buildOwnerAssistantPrompt } from "./owner-assistant.prompt.js";
import { OWNER_TOOLS, executeOwnerTool, type OwnerToolContext } from "./owner-assistant.tools.js";
import {
  conversationTitle,
  toConversationView,
  toMessageView,
  type OwnerConversation,
  type OwnerConversationView,
  type OwnerMessage,
  type OwnerMessageView,
  type OwnerToolCallLog,
} from "./owner-assistant.model.js";
import {
  CONTEXT_WINDOW_CHARS,
  CONTEXT_WINDOW_MESSAGES,
  MAX_MESSAGES_PER_CONVERSATION,
  RECENT_TOOL_CALLS_IN_PROMPT,
} from "./owner-assistant.validation.js";

const FALLBACK_REPLY =
  "Sorry, I could not prepare an answer this time. Please try rephrasing your question. / عذراً، لم أتمكن من إعداد إجابة. حاول إعادة صياغة سؤالك.";

/** Owner assistant model settings: low temperature for factual answers, a few tool rounds. */
const MODEL_SETTINGS = { temperature: 0.2, maxTokens: 2048, maxRounds: 5, maxToolCallsPerRound: 5, maxToolCalls: 10 } as const;

/**
 * The assistant analyzes the owner's first store (oldest), matching the dashboard AI chat.
 * The store is always derived from the authenticated owner.
 */
export function storeForOwner(ownerId: string): Store {
  const store = storage.stores
    .findAll((s) => s.ownerId === ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (store === undefined) {
    throw AppError.businessRule("No store found. Create a store first.");
  }
  return store;
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

function messagesOf(conversationId: string): OwnerMessage[] {
  // findAll preserves insertion order; the stable sort keeps user-before-assistant on equal timestamps.
  return storage.ownerMessages
    .findAll((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Throws 404 (not 403) for unknown IDs and other owners' IDs alike, so IDs are not disclosed. */
function findOwnedConversation(ownerId: string, conversationId: string): OwnerConversation {
  const conversation = storage.ownerConversations.findOne((c) => c.id === conversationId && c.ownerId === ownerId);
  if (conversation === undefined) {
    throw AppError.notFound("Conversation not found");
  }
  return conversation;
}

export function listConversations(ownerId: string): OwnerConversationView[] {
  return storage.ownerConversations
    .findAll((c) => c.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => toConversationView(c, storage.ownerMessages.count((m) => m.conversationId === c.id)));
}

export function getConversation(
  ownerId: string,
  conversationId: string,
): { conversation: OwnerConversationView; messages: OwnerMessageView[] } {
  const conversation = findOwnedConversation(ownerId, conversationId);
  const messages = messagesOf(conversationId);
  return { conversation: toConversationView(conversation, messages.length), messages: messages.map(toMessageView) };
}

export async function deleteConversation(ownerId: string, conversationId: string): Promise<void> {
  findOwnedConversation(ownerId, conversationId);
  await storage.ownerMessages.deleteWhere((m) => m.conversationId === conversationId);
  await storage.ownerConversations.delete(conversationId);
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

/** Recent messages for the model: bounded by count and characters, starting with a user turn. */
export function buildContextWindow(history: readonly OwnerMessage[]): AiMessage[] {
  const window: OwnerMessage[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && window.length < CONTEXT_WINDOW_MESSAGES; i--) {
    const message = history[i]!;
    if (chars + message.content.length > CONTEXT_WINDOW_CHARS && window.length > 0) break;
    chars += message.content.length;
    window.unshift(message);
  }
  while (window.length > 0 && window[0]!.role !== "user") window.shift();
  return window.map((m) => ({ role: m.role, content: m.content }));
}

function recentToolCalls(history: readonly OwnerMessage[]): { name: string; arguments: Record<string, unknown> | null }[] {
  return history
    .flatMap((m) => (m.role === "assistant" ? (m.toolCalls ?? []) : []))
    .filter((call) => call.ok)
    .slice(-RECENT_TOOL_CALLS_IN_PROMPT)
    .map((call) => ({ name: call.name, arguments: call.arguments }));
}

function toToolCallLog(call: ToolCallRecord): OwnerToolCallLog {
  const parsed = parseToolArgs(call.arguments);
  return { name: call.name, arguments: "error" in parsed && Object.keys(parsed).length === 1 ? null : parsed, ok: call.ok };
}

const UNGROUNDED_NOTICE =
  "(System notice: your draft contains figures, but no business data was retrieved for this message, so the draft was NOT shown to the owner. Earlier messages may be outdated or about a different period. Call the appropriate tools now, then write the answer from scratch using only the retrieved data. Do not mention the draft or any correction.)";

/**
 * Reject a reply that states figures when no tool succeeded during this message. Numbered-list
 * markers ("1.", "2)") are ignored. A false positive only costs one extra model round.
 */
export function ungroundedFiguresNotice(reply: string, toolCalls: readonly ToolCallRecord[]): string | null {
  if (toolCalls.some((call) => call.ok)) return null;
  const withoutListMarkers = reply.replace(/^\s*\d+[.)]\s/gm, "");
  return /\d/.test(withoutListMarkers) ? UNGROUNDED_NOTICE : null;
}

/** Conversations with a reply currently being generated (single process — see AGENTS.md). */
const inFlight = new Set<string>();

export interface ChatResult {
  conversationId: string;
  createdConversation: boolean;
  message: OwnerMessageView;
  toolsUsed: string[];
}

/**
 * Process one owner message. Nothing is persisted unless the model produced an answer: a failed
 * AI call leaves the conversation exactly as it was (and creates no empty conversation).
 */
export async function chat(
  auth: AuthContext,
  conversationId: string | undefined,
  message: string,
  now: Date = new Date(),
): Promise<ChatResult> {
  if (!isAiConfigured()) {
    throw AppError.businessRule("AI provider is not configured. Set AI_BASE_URL and AI_API_KEY.");
  }

  const store = storeForOwner(auth.ownerId);
  let existing: OwnerConversation | null = null;
  if (conversationId !== undefined) {
    existing = findOwnedConversation(auth.ownerId, conversationId);
    if (existing.storeId !== store.id) {
      throw AppError.notFound("Conversation not found");
    }
  }

  const history = existing === null ? [] : messagesOf(existing.id);
  if (history.length + 2 > MAX_MESSAGES_PER_CONVERSATION) {
    throw AppError.businessRule("This conversation has reached its message limit. Start a new conversation.");
  }

  const lockKey = existing?.id;
  if (lockKey !== undefined) {
    if (inFlight.has(lockKey)) {
      throw AppError.conflict("A reply is still being generated for this conversation. Wait for it, then try again.");
    }
    inFlight.add(lockKey);
  }

  try {
    const toolContext: OwnerToolContext = { storeId: store.id, now };
    let result;
    try {
      result = await runAgentLoop({
        systemPrompt: buildOwnerAssistantPrompt({ storeName: store.name, now, recentToolCalls: recentToolCalls(history) }),
        messages: [...buildContextWindow(history), { role: "user", content: message }],
        tools: OWNER_TOOLS,
        executeTool: (name, argsJson) => executeOwnerTool(name, argsJson, toolContext),
        checkReply: ungroundedFiguresNotice,
        ...MODEL_SETTINGS,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        logger.error({ err: error, statusCode: error.statusCode }, "Owner assistant AI request failed");
        throw AppError.aiProviderError();
      }
      throw error;
    }

    const reply = result.reply === "" ? FALLBACK_REPLY : result.reply;
    const conversation =
      existing ??
      (await storage.ownerConversations.create({
        ownerId: auth.ownerId,
        storeId: store.id,
        assistantType: "owner",
        title: conversationTitle(message),
      }));

    await storage.ownerMessages.create({ conversationId: conversation.id, storeId: store.id, role: "user", content: message });
    const assistant = await storage.ownerMessages.create({
      conversationId: conversation.id,
      storeId: store.id,
      role: "assistant",
      content: reply,
      toolCalls: result.toolCalls.map(toToolCallLog),
    });
    // A no-op update refreshes updatedAt (managed by the storage layer) for "recent first" lists.
    await storage.ownerConversations.update(conversation.id, {});

    const view = toMessageView(assistant);
    return { conversationId: conversation.id, createdConversation: existing === null, message: view, toolsUsed: view.toolsUsed };
  } finally {
    if (lockKey !== undefined) inFlight.delete(lockKey);
  }
}
