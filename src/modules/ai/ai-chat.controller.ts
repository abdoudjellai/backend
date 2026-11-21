import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getAuth } from "../../shared/utils/request-context.js";
import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { isAiConfigured } from "./ai.service.js";
import { handleCustomerMessage } from "./ai-agent.service.js";
import { conversationMemory, ConversationMemory } from "./memory/conversation-memory.js";
import { recommendCourier } from "./courier-quotes.js";

const ORDER_FIELDS = ["product", "color", "size", "quantity", "wilaya", "customerName", "phone", "address", "price"] as const;

type OrderField = (typeof ORDER_FIELDS)[number];

interface DraftSnapshot {
  product: string | null;
  color: string | null;
  size: string | null;
  quantity: string | null;
  wilaya: string | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  price: string | null;
}

function computeRisk(draft: DraftSnapshot): { band: string; reason: string } {
  const filled = ORDER_FIELDS.filter((f) => draft[f] !== null).length;
  if (filled < 3) return { band: "insufficient", reason: "Not enough order details collected yet." };
  const missing: OrderField[] = ORDER_FIELDS.filter((f) => draft[f] === null);
  if (missing.includes("phone") || missing.includes("address")) {
    return { band: "high", reason: "Missing contact or address information increases refusal risk." };
  }
  if (missing.length > 2) {
    return { band: "medium", reason: "Several order fields are still missing." };
  }
  return { band: "low", reason: "Order details are mostly complete." };
}

/**
 * POST /api/v1/ai/chat
 * Dashboard AI chat — simulates a customer conversation from the dashboard.
 */
export const postAiChat: RequestHandler = async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    throw AppError.badRequest("message is required");
  }

  if (!isAiConfigured()) {
    throw AppError.businessRule("AI provider is not configured. Set AI_BASE_URL and AI_API_KEY.");
  }

  const auth = getAuth(req);
  const stores = storage.stores.findAll((s) => s.ownerId === auth.ownerId);
  const store = stores[0];
  if (!store) {
    throw AppError.businessRule("No store found. Create a store first.");
  }

  const dashboardUserId = "dashboard";
  const response = await handleCustomerMessage(store.id, store.name, dashboardUserId, message);

  const sessionKey = ConversationMemory.sessionKey(store.id, dashboardUserId);
  const session = conversationMemory.get(sessionKey);
  const draft = session?.orderDraft;

  const draftSnapshot: DraftSnapshot = {
    product: draft?.items[0]?.productName ?? null,
    color: draft?.items[0]?.color ?? null,
    size: draft?.items[0]?.size != null ? String(draft.items[0].size) : null,
    quantity: draft?.items[0]?.quantity != null ? String(draft.items[0].quantity) : null,
    wilaya: draft?.wilaya ?? null,
    customerName: draft?.customerName ?? null,
    phone: draft?.customerPhone ?? null,
    address: draft?.address ?? null,
    price: null,
  };

  const missing = ORDER_FIELDS.filter((f): f is OrderField => draftSnapshot[f] === null);
  const risk = computeRisk(draftSnapshot);
  const courier = recommendCourier(draftSnapshot.wilaya);

  sendSuccess(req, res, {
    reply: response.reply,
    toolsUsed: response.toolsUsed,
    order: draftSnapshot,
    missing,
    risk,
    courier,
  });
};

/**
 * POST /api/v1/ai/chat/reset
 * Reset the dashboard conversation session.
 */
export const postAiChatReset: RequestHandler = (req, res) => {
  const auth = getAuth(req);
  const stores = storage.stores.findAll((s) => s.ownerId === auth.ownerId);
  const store = stores[0];
  if (store) {
    const sessionKey = ConversationMemory.sessionKey(store.id, "dashboard");
    conversationMemory.delete(sessionKey);
  }
  sendSuccess(req, res, { reset: true });
};
