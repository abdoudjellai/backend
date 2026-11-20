import { storage } from "../../storage/index.js";
import { aiStats, businessStats, orderStats, type AiStats, type BusinessStats, type OrderStats } from "./analytics.calculations.js";

export interface DateRange {
  from?: Date | undefined;
  to?: Date | undefined;
}

function inRange(createdAt: string, range: DateRange): boolean {
  const time = Date.parse(createdAt);
  return (range.from === undefined || time >= range.from.getTime()) && (range.to === undefined || time <= range.to.getTime());
}

export function getOverview(storeId: string): { business: BusinessStats; ai: AiStats } {
  const inStore = (record: { storeId: string }) => record.storeId === storeId;
  return {
    business: businessStats(storage.orders.findAll(inStore), storage.customers.count(inStore), storage.products.count(inStore)),
    ai: aiStats(storage.aiAnalytics.findAll(inStore)),
  };
}

export function getOrderStats(storeId: string, range: DateRange): OrderStats & { range: { from: string | null; to: string | null } } {
  const orders = storage.orders.findAll((order) => order.storeId === storeId && inRange(order.createdAt, range));
  return {
    range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
    ...orderStats(orders),
  };
}

export function getAiStats(storeId: string): AiStats {
  return aiStats(storage.aiAnalytics.findAll((analysis) => analysis.storeId === storeId));
}
