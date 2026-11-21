import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { AppError } from "../../shared/errors/app-error.js";
import { idParams } from "../../shared/validation/common.js";
import { storage } from "../../storage/index.js";
import { isAiConfigured, aiComplete } from "../ai/ai.service.js";
import { buildReturnRiskPrompt } from "../ai/prompts/order-analysis.prompt.js";
import { recommendCourier } from "../ai/courier-quotes.js";
import { createAiAnalysis } from "./ai-analytics.service.js";
import type { RiskLevel } from "./ai-analysis.model.js";
import type { Order } from "../orders/order.model.js";
import type { Customer } from "../customers/customer.model.js";

const orderParams = idParams("orderId");

function buildOrderContext(order: Order, customer: Customer | undefined, orderHistory: Order[]): string {
  const delivered = orderHistory.filter((o) => o.status === "delivered").length;
  const refused = orderHistory.filter((o) => o.status === "refused").length;
  const returned = orderHistory.filter((o) => o.status === "returned").length;

  return JSON.stringify({
    orderId: order.id,
    totalAmount: order.totalAmount,
    currency: order.currency,
    itemCount: order.items.length,
    items: order.items.map((i) => ({ name: i.productName, qty: i.quantity, price: i.unitPrice })),
    delivery: { wilaya: order.delivery.wilaya, hasAddress: Boolean(order.delivery.address), hasPhone: Boolean(order.delivery.phone) },
    customer: customer
      ? { name: customer.name, hasPhone: Boolean(customer.phone), wilaya: customer.wilaya, source: customer.source }
      : null,
    customerHistory: { totalOrders: orderHistory.length, delivered, refused, returned },
  });
}

interface AiRiskResponse {
  returnRisk: number;
  riskLevel: RiskLevel;
  recommendations: string[];
  reasoning: string;
}

function parseRiskResponse(raw: string): AiRiskResponse {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const returnRisk = typeof parsed.returnRisk === "number" ? Math.max(0, Math.min(1, parsed.returnRisk)) : 0.5;
  let riskLevel: RiskLevel;
  if (returnRisk < 0.3) riskLevel = "low";
  else if (returnRisk < 0.6) riskLevel = "medium";
  else riskLevel = "high";
  return {
    returnRisk,
    riskLevel,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 10) : [],
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}

/**
 * POST /api/v1/stores/:storeId/orders/:orderId/analyze
 * Run AI return-risk analysis on an order and persist the result.
 */
export const analyzeOrder: RequestHandler = async (req, res) => {
  const store = getStore(req);
  const { orderId } = orderParams.parse(req.params);

  const order = storage.orders.findOne((o) => o.id === orderId && o.storeId === store.id);
  if (!order) throw AppError.notFound("Order not found");

  if (!isAiConfigured()) {
    throw AppError.businessRule("AI provider is not configured. Set AI_BASE_URL and AI_API_KEY.");
  }

  const customer = storage.customers.findOne((c) => c.id === order.customerId && c.storeId === store.id);
  const customerOrders = customer
    ? storage.orders.findAll((o) => o.storeId === store.id && o.customerId === customer.id)
    : [];

  const context = buildOrderContext(order, customer, customerOrders);

  const result = await aiComplete({
    messages: [
      { role: "system", content: buildReturnRiskPrompt() },
      { role: "user", content: context },
    ],
    temperature: 0.3,
    maxTokens: 1024,
  });

  let riskData: AiRiskResponse;
  try {
    riskData = parseRiskResponse(result.content ?? "{}");
  } catch {
    riskData = {
      returnRisk: 0.5,
      riskLevel: "medium",
      recommendations: ["Unable to parse AI response. Manual review recommended."],
      reasoning: "AI response could not be parsed.",
    };
  }

  const courier = recommendCourier(order.delivery.wilaya);

  const analysis = await createAiAnalysis(store.id, {
    orderId: order.id,
    returnRisk: riskData.returnRisk,
    riskLevel: riskData.riskLevel,
    recommendedCourier: courier.recommended,
    recommendations: riskData.recommendations,
  });

  sendSuccess(req, res, {
    analysis,
    reasoning: riskData.reasoning,
    courier,
  }, 201);
};
