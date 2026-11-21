import type { BaseRecord } from "../../storage/json-collection.js";

/**
 * A persisted owner-assistant conversation. Each conversation belongs to one owner account and
 * one store (businessId). Conversations are private to their owner and never exposed through
 * the dashboard APIs.
 */
export interface OwnerConversation extends BaseRecord {
  ownerId: string;
  /** The store the conversation is about (derived from the authenticated owner, never from input). */
  storeId: string;
  assistantType: "owner";
  title: string;
}

export interface OwnerMessage extends BaseRecord {
  conversationId: string;
  /** Store the message belongs to — kept for consistency with other records. */
  storeId: string;
  role: "user" | "assistant";
  content: string;
}

/** Conversation title derived from the first user message. */
export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, " ");
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}...`;
}
