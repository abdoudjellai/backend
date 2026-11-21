import type { BaseRecord } from "../../storage/json-collection.js";

/**
 * A persisted owner-assistant conversation. Each conversation belongs to one owner account and
 * one store (the "business"). Both are derived from the authenticated session, never from input.
 * Owner-assistant conversations are stored separately from customer (Telegram) conversations.
 */
export interface OwnerConversation extends BaseRecord {
  ownerId: string;
  storeId: string;
  assistantType: "owner";
  title: string;
}

/** A tool call made while producing an assistant message. Results are not stored. */
export interface OwnerToolCallLog {
  name: string;
  /** Parsed arguments as sent by the model, or null when they were not valid JSON. */
  arguments: Record<string, unknown> | null;
  ok: boolean;
}

export interface OwnerMessage extends BaseRecord {
  conversationId: string;
  storeId: string;
  role: "user" | "assistant";
  content: string;
  /** Assistant messages only: the tools used to produce the answer (absent on older records). */
  toolCalls?: OwnerToolCallLog[];
}

/** Conversation title derived from the first user message. */
export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, " ");
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}...`;
}

/** Public shape of a message in API responses. */
export interface OwnerMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolsUsed: string[];
}

export function toMessageView(message: OwnerMessage): OwnerMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    toolsUsed: [...new Set((message.toolCalls ?? []).filter((c) => c.ok).map((c) => c.name))],
  };
}

/** Public shape of a conversation in API responses. */
export interface OwnerConversationView {
  id: string;
  title: string;
  storeId: string;
  assistantType: "owner";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export function toConversationView(conversation: OwnerConversation, messageCount: number): OwnerConversationView {
  return {
    id: conversation.id,
    title: conversation.title,
    storeId: conversation.storeId,
    assistantType: conversation.assistantType,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount,
  };
}
