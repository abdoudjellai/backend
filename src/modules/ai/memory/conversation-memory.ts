import type { AiMessage } from "../providers/aigrid.provider.js";

export interface ConversationSession {
  messages: AiMessage[];
  /** Collected order draft fields. */
  orderDraft: OrderDraft;
  createdAt: number;
  lastActivityAt: number;
}

export interface OrderDraft {
  customerName: string | null;
  customerPhone: string | null;
  wilaya: string | null;
  address: string | null;
  items: OrderDraftItem[];
  confirmed: boolean;
}

export interface OrderDraftItem {
  productId: string;
  productName: string;
  quantity: number;
  size: string | number | null;
  color: string | null;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES = 40; // keep last N messages to bound memory
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // sweep every 5 minutes

function emptyDraft(): OrderDraft {
  return { customerName: null, customerPhone: null, wilaya: null, address: null, items: [], confirmed: false };
}

/**
 * In-memory conversation sessions, keyed by `storeId:telegramUserId`.
 * Sessions expire after a configurable TTL. Memory is lost on restart.
 */
export class ConversationMemory {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  static sessionKey(storeId: string, telegramUserId: string): string {
    return `${storeId}:${telegramUserId}`;
  }

  get(key: string): ConversationSession | undefined {
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    if (Date.now() - session.lastActivityAt > this.ttlMs) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  getOrCreate(key: string): ConversationSession {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const now = Date.now();
    const session: ConversationSession = {
      messages: [],
      orderDraft: emptyDraft(),
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(key, session);
    return session;
  }

  addMessage(key: string, message: AiMessage): void {
    const session = this.getOrCreate(key);
    session.messages.push(message);
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }
    session.lastActivityAt = Date.now();
  }

  updateDraft(key: string, patch: Partial<OrderDraft>): void {
    const session = this.getOrCreate(key);
    Object.assign(session.orderDraft, patch);
    session.lastActivityAt = Date.now();
  }

  resetDraft(key: string): void {
    const session = this.get(key);
    if (session !== undefined) {
      session.orderDraft = emptyDraft();
    }
  }

  delete(key: string): void {
    this.sessions.delete(key);
  }

  get size(): number {
    return this.sessions.size;
  }

  startCleanup(): void {
    if (this.cleanupTimer !== null) return;
    this.cleanupTimer = setInterval(() => this.sweep(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityAt > this.ttlMs) {
        this.sessions.delete(key);
      }
    }
  }
}

export const conversationMemory = new ConversationMemory();
