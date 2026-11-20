import { RISK_LEVELS, type AiAnalysis, type RiskLevel } from "../ai-analytics/ai-analysis.model.js";
import { ORDER_STATUSES, type OrderStatus } from "../orders/order-status.js";
import type { Order } from "../orders/order.model.js";

/**
 * Pure statistics functions. They only count stored data: when there is nothing to measure they
 * return zeros, empty lists or null — never estimated values.
 *
 * Predicted return risk (from AI analyses) and the actual return rate (from order outcomes) are
 * reported separately and must not be mixed.
 */

const round = (value: number, decimals = 4): number => Math.round(value * 10 ** decimals) / 10 ** decimals;

export function countByStatus(orders: readonly Order[]): Record<OrderStatus, number> {
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
  for (const order of orders) counts[order.status] += 1;
  return counts;
}

export interface DeliveryOutcomes {
  delivered: number;
  refused: number;
  returned: number;
  /** Orders with a final delivery outcome (delivered + refused + returned). */
  completed: number;
  /** Actual share of completed orders that were refused or returned; null when none completed. */
  actualReturnRate: number | null;
}

export function deliveryOutcomes(orders: readonly Order[]): DeliveryOutcomes {
  const counts = countByStatus(orders);
  const completed = counts.delivered + counts.refused + counts.returned;
  return {
    delivered: counts.delivered,
    refused: counts.refused,
    returned: counts.returned,
    completed,
    actualReturnRate: completed === 0 ? null : round((counts.refused + counts.returned) / completed),
  };
}

export interface BusinessStats {
  totalOrders: number;
  totalCustomers: number;
  totalProducts: number;
  ordersByStatus: Record<OrderStatus, number>;
  /** Sum of totalAmount over orders currently in status "delivered", in DZD. */
  deliveredRevenue: number;
  currency: "DZD";
}

export function businessStats(orders: readonly Order[], totalCustomers: number, totalProducts: number): BusinessStats {
  return {
    totalOrders: orders.length,
    totalCustomers,
    totalProducts,
    ordersByStatus: countByStatus(orders),
    deliveredRevenue: orders.filter((o) => o.status === "delivered").reduce((sum, o) => sum + o.totalAmount, 0),
    currency: "DZD",
  };
}

export interface OrderStats {
  totalOrders: number;
  ordersByStatus: Record<OrderStatus, number>;
  /** Orders created per UTC day (only days with orders), oldest first. */
  ordersByDay: { date: string; count: number }[];
  deliveredRevenue: number;
  /** Mean totalAmount of delivered orders; null when there are none. */
  averageDeliveredOrderValue: number | null;
  outcomes: DeliveryOutcomes;
  currency: "DZD";
}

export function orderStats(orders: readonly Order[]): OrderStats {
  const perDay = new Map<string, number>();
  for (const order of orders) {
    const day = order.createdAt.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const delivered = orders.filter((o) => o.status === "delivered");
  const deliveredRevenue = delivered.reduce((sum, o) => sum + o.totalAmount, 0);
  return {
    totalOrders: orders.length,
    ordersByStatus: countByStatus(orders),
    ordersByDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    deliveredRevenue,
    averageDeliveredOrderValue: delivered.length === 0 ? null : round(deliveredRevenue / delivered.length, 2),
    outcomes: deliveryOutcomes(orders),
    currency: "DZD",
  };
}

export interface AiStats {
  /** Every stored analysis, including re-analyses of the same order. */
  totalAnalyses: number;
  /** Distinct orders with at least one analysis. */
  analyzedOrders: number;
  /** Mean predicted risk over each order's latest analysis; null when nothing is analyzed. */
  averagePredictedReturnRisk: number | null;
  /** Orders whose latest analysis is "high". */
  highRiskOrders: number;
  /** Orders per risk level, using each order's latest analysis. */
  riskDistribution: Record<RiskLevel, number>;
  /** Latest-analysis courier recommendations, most frequent first. Orders without one are excluded. */
  courierRecommendations: { courier: string; orders: number }[];
}

/** Each order counts once, by its most recent analysis, so re-analysis does not double count. */
export function latestAnalysisPerOrder(analyses: readonly AiAnalysis[]): AiAnalysis[] {
  const latest = new Map<string, AiAnalysis>();
  for (const analysis of analyses) {
    const current = latest.get(analysis.orderId);
    if (current === undefined || analysis.createdAt >= current.createdAt) latest.set(analysis.orderId, analysis);
  }
  return [...latest.values()];
}

export function aiStats(analyses: readonly AiAnalysis[]): AiStats {
  const latest = latestAnalysisPerOrder(analyses);
  const riskDistribution = Object.fromEntries(RISK_LEVELS.map((level) => [level, 0])) as Record<RiskLevel, number>;
  const couriers = new Map<string, number>();
  for (const analysis of latest) {
    riskDistribution[analysis.riskLevel] += 1;
    if (analysis.recommendedCourier !== null) {
      couriers.set(analysis.recommendedCourier, (couriers.get(analysis.recommendedCourier) ?? 0) + 1);
    }
  }
  return {
    totalAnalyses: analyses.length,
    analyzedOrders: latest.length,
    averagePredictedReturnRisk:
      latest.length === 0 ? null : round(latest.reduce((sum, a) => sum + a.returnRisk, 0) / latest.length),
    highRiskOrders: riskDistribution.high,
    riskDistribution,
    courierRecommendations: [...couriers.entries()]
      .map(([courier, orders]) => ({ courier, orders }))
      .sort((a, b) => b.orders - a.orders || a.courier.localeCompare(b.courier)),
  };
}
