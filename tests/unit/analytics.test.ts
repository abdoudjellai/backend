import { describe, expect, it } from "vitest";
import type { AiAnalysis } from "../../src/modules/ai-analytics/ai-analysis.model.js";
import {
  aiStats,
  businessStats,
  deliveryOutcomes,
  latestAnalysisPerOrder,
  orderStats,
} from "../../src/modules/analytics/analytics.calculations.js";
import type { Order } from "../../src/modules/orders/order.model.js";
import type { OrderStatus } from "../../src/modules/orders/order-status.js";

let n = 0;
const order = (status: OrderStatus, totalAmount: number, createdAt = "2026-11-20T10:00:00.000Z"): Order => ({
  id: `order_${++n}`,
  storeId: "store_1",
  customerId: "customer_1",
  items: [],
  totalAmount,
  currency: "DZD",
  delivery: { wilaya: null, address: null, phone: null, company: null, trackingNumber: null },
  status,
  source: "manual",
  notes: null,
  statusHistory: [],
  createdAt,
  updatedAt: createdAt,
});

const analysis = (
  orderId: string,
  returnRisk: number,
  riskLevel: AiAnalysis["riskLevel"],
  createdAt: string,
  recommendedCourier: string | null = null,
): AiAnalysis => ({
  id: `analysis_${++n}`,
  storeId: "store_1",
  orderId,
  returnRisk,
  riskLevel,
  recommendedCourier,
  recommendations: [],
  createdAt,
  updatedAt: createdAt,
});

describe("business and order statistics", () => {
  it("returns zeros, not guesses, when there is no data", () => {
    const stats = businessStats([], 0, 0);
    expect(stats.totalOrders).toBe(0);
    expect(stats.deliveredRevenue).toBe(0);
    expect(Object.values(stats.ordersByStatus).every((count) => count === 0)).toBe(true);
    expect(Object.keys(stats.ordersByStatus)).toHaveLength(9);

    const orders = orderStats([]);
    expect(orders.ordersByDay).toEqual([]);
    expect(orders.averageDeliveredOrderValue).toBeNull();
    expect(orders.outcomes.actualReturnRate).toBeNull();
  });

  it("counts statuses and only counts delivered orders as revenue", () => {
    const orders = [order("delivered", 9000), order("delivered", 4500), order("shipped", 7900), order("cancelled", 1000)];
    const stats = businessStats(orders, 3, 5);
    expect(stats).toMatchObject({ totalOrders: 4, totalCustomers: 3, totalProducts: 5, deliveredRevenue: 13_500 });
    expect(stats.ordersByStatus).toMatchObject({ delivered: 2, shipped: 1, cancelled: 1, draft: 0 });
  });

  it("computes the actual return rate from completed outcomes only", () => {
    const outcomes = deliveryOutcomes([
      order("delivered", 1),
      order("delivered", 1),
      order("delivered", 1),
      order("refused", 1),
      order("returned", 1),
      order("shipped", 1), // in transit: not an outcome yet
    ]);
    expect(outcomes).toEqual({ delivered: 3, refused: 1, returned: 1, completed: 5, actualReturnRate: 0.4 });
  });

  it("groups orders per UTC day and averages delivered order value", () => {
    const stats = orderStats([
      order("delivered", 4000, "2026-11-19T23:30:00.000Z"),
      order("delivered", 5000, "2026-11-20T08:00:00.000Z"),
      order("draft", 100, "2026-11-20T09:00:00.000Z"),
    ]);
    expect(stats.ordersByDay).toEqual([
      { date: "2026-11-19", count: 1 },
      { date: "2026-11-20", count: 2 },
    ]);
    expect(stats.averageDeliveredOrderValue).toBe(4500);
  });
});

describe("AI statistics", () => {
  it("returns empty statistics when nothing was analyzed", () => {
    expect(aiStats([])).toEqual({
      totalAnalyses: 0,
      analyzedOrders: 0,
      averagePredictedReturnRisk: null,
      highRiskOrders: 0,
      riskDistribution: { low: 0, medium: 0, high: 0 },
      courierRecommendations: [],
    });
  });

  it("uses each order's latest analysis so re-analysis does not double count", () => {
    const analyses = [
      analysis("order_a", 0.9, "high", "2026-11-20T08:00:00.000Z", "EcoTrack"),
      analysis("order_a", 0.2, "low", "2026-11-20T09:00:00.000Z", "Yalidine"), // newer → wins
      analysis("order_b", 0.8, "high", "2026-11-20T08:00:00.000Z", "EcoTrack"),
      analysis("order_c", 0.5, "medium", "2026-11-20T08:00:00.000Z", null),
    ];
    expect(latestAnalysisPerOrder(analyses).map((a) => a.returnRisk).sort()).toEqual([0.2, 0.5, 0.8]);
    expect(aiStats(analyses)).toEqual({
      totalAnalyses: 4,
      analyzedOrders: 3,
      averagePredictedReturnRisk: 0.5,
      highRiskOrders: 1,
      riskDistribution: { low: 1, medium: 1, high: 1 },
      courierRecommendations: [
        { courier: "EcoTrack", orders: 1 },
        { courier: "Yalidine", orders: 1 },
      ],
    });
  });
});
