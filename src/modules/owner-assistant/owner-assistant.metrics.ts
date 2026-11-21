import { countByStatus } from "../analytics/analytics.calculations.js";
import type { OrderStatus } from "../orders/order-status.js";
import type { Order } from "../orders/order.model.js";

/**
 * Pure business metrics for the owner assistant. Counts only stored data; rates are percentages
 * with one decimal (so the model never has to convert fractions), or null when the denominator is 0.
 *
 * Definitions (also stated to the model in tool descriptions):
 * - confirmed: the order reached "confirmed" at some point (current status is confirmed or later,
 *   or "confirmed" appears in its status history — e.g. confirmed then cancelled).
 * - confirmation rate: confirmed / orders that left the confirmation stage
 *   (excludes orders still in draft or pending_confirmation).
 * - completed deliveries: delivered + refused + returned (orders with a final delivery outcome).
 * - return rate: (refused + returned) / completed deliveries.
 * - delivered revenue: totalAmount of orders whose current status is delivered.
 */

const POST_CONFIRMATION: readonly OrderStatus[] = ["confirmed", "pending_dispatch", "shipped", "delivered", "refused", "returned"];
const PENDING_CONFIRMATION: readonly OrderStatus[] = ["draft", "pending_confirmation"];

export const pct = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

const sum = (orders: readonly Order[]): number => orders.reduce((total, order) => total + order.totalAmount, 0);

export function wasConfirmed(order: Order): boolean {
  return POST_CONFIRMATION.includes(order.status) || order.statusHistory.some((change) => change.status === "confirmed");
}

export const isReturnOutcome = (order: Order): boolean => order.status === "refused" || order.status === "returned";
export const isCompletedDelivery = (order: Order): boolean => order.status === "delivered" || isReturnOutcome(order);

export interface PeriodMetrics {
  totalOrders: number;
  ordersByStatus: Record<OrderStatus, number>;
  awaitingConfirmation: number;
  confirmedOrders: number;
  confirmationRatePct: number | null;
  cancelledOrders: number;
  cancellationRatePct: number | null;
  waitingForShipment: number;
  inDelivery: number;
  deliveredOrders: number;
  refusedOrders: number;
  returnedOrders: number;
  completedDeliveries: number;
  deliverySuccessRatePct: number | null;
  returnRatePct: number | null;
  deliveredRevenue: number;
  averageDeliveredOrderValue: number | null;
  /** Value of confirmed orders not yet delivered (confirmed, pending_dispatch, shipped). */
  pipelineValue: number;
  /** Value of refused and returned orders. */
  lostToReturnsValue: number;
  currency: "DZD";
}

export function periodMetrics(orders: readonly Order[]): PeriodMetrics {
  const byStatus = countByStatus(orders);
  const awaiting = orders.filter((o) => PENDING_CONFIRMATION.includes(o.status)).length;
  const confirmed = orders.filter(wasConfirmed).length;
  const delivered = orders.filter((o) => o.status === "delivered");
  const completed = byStatus.delivered + byStatus.refused + byStatus.returned;
  const deliveredRevenue = sum(delivered);
  return {
    totalOrders: orders.length,
    ordersByStatus: byStatus,
    awaitingConfirmation: awaiting,
    confirmedOrders: confirmed,
    confirmationRatePct: pct(confirmed, orders.length - awaiting),
    cancelledOrders: byStatus.cancelled,
    cancellationRatePct: pct(byStatus.cancelled, orders.length),
    waitingForShipment: byStatus.confirmed + byStatus.pending_dispatch,
    inDelivery: byStatus.shipped,
    deliveredOrders: byStatus.delivered,
    refusedOrders: byStatus.refused,
    returnedOrders: byStatus.returned,
    completedDeliveries: completed,
    deliverySuccessRatePct: pct(byStatus.delivered, completed),
    returnRatePct: pct(byStatus.refused + byStatus.returned, completed),
    deliveredRevenue,
    averageDeliveredOrderValue: delivered.length === 0 ? null : Math.round(deliveredRevenue / delivered.length),
    pipelineValue: sum(orders.filter((o) => o.status === "confirmed" || o.status === "pending_dispatch" || o.status === "shipped")),
    lostToReturnsValue: sum(orders.filter(isReturnOutcome)),
    currency: "DZD",
  };
}

export interface MetricChange {
  current: number | null;
  previous: number | null;
  change: number | null;
  /** Relative change in percent; null when previous is 0 or either side is missing. */
  changePct: number | null;
}

/** Field-by-field change for the numeric metrics of two periods. */
export function compareMetrics(current: PeriodMetrics, previous: PeriodMetrics): Record<string, MetricChange> {
  const fields = [
    "totalOrders",
    "confirmedOrders",
    "confirmationRatePct",
    "cancelledOrders",
    "cancellationRatePct",
    "deliveredOrders",
    "returnRatePct",
    "deliverySuccessRatePct",
    "deliveredRevenue",
    "averageDeliveredOrderValue",
  ] as const;
  const result: Record<string, MetricChange> = {};
  for (const field of fields) {
    const cur = current[field];
    const prev = previous[field];
    const change = cur === null || prev === null ? null : Math.round((cur - prev) * 10) / 10;
    result[field] = {
      current: cur,
      previous: prev,
      change,
      changePct: change === null || prev === null || prev === 0 ? null : Math.round((change / prev) * 1000) / 10,
    };
  }
  return result;
}

/** Case/whitespace-insensitive courier key ("Yalidine", " yalidine " → "yalidine"). */
export function courierKey(company: string): string {
  return company.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Days between the first "shipped" and the first "delivered" status change, or null. */
export function deliveryDays(order: Order): number | null {
  const shipped = order.statusHistory.find((change) => change.status === "shipped");
  const delivered = order.statusHistory.find((change) => change.status === "delivered");
  if (shipped === undefined || delivered === undefined) return null;
  const days = (Date.parse(delivered.at) - Date.parse(shipped.at)) / (24 * 60 * 60 * 1000);
  return days >= 0 ? days : null;
}

/** Group items by a key, preserving first-seen order. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [item]);
    else list.push(item);
  }
  return groups;
}

/** Outcome breakdown for a group of orders (wilaya, product, courier, channel...). */
export function outcomeRow(orders: readonly Order[]): {
  orders: number;
  completedDeliveries: number;
  delivered: number;
  refusedOrReturned: number;
  returnRatePct: number | null;
} {
  const completed = orders.filter(isCompletedDelivery);
  const returned = completed.filter(isReturnOutcome).length;
  return {
    orders: orders.length,
    completedDeliveries: completed.length,
    delivered: completed.length - returned,
    refusedOrReturned: returned,
    returnRatePct: pct(returned, completed.length),
  };
}
