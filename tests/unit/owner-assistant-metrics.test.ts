import { describe, it, expect } from "vitest";
import type { Order } from "../../src/modules/orders/order.model.js";
import type { OrderStatus } from "../../src/modules/orders/order-status.js";
import {
  compareMetrics,
  courierKey,
  deliveryDays,
  periodMetrics,
  wasConfirmed,
} from "../../src/modules/owner-assistant/owner-assistant.metrics.js";

let n = 0;
function order(status: OrderStatus, total: number, history: OrderStatus[] = [status], at: string[] = []): Order {
  n += 1;
  return {
    id: `order_${n}`,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    storeId: "store_a",
    customerId: "customer_a",
    items: [],
    totalAmount: total,
    currency: "DZD",
    delivery: { wilaya: null, address: null, phone: null, company: null, trackingNumber: null },
    status,
    source: "manual",
    notes: null,
    statusHistory: history.map((s, i) => ({ status: s, at: at[i] ?? "2026-11-01T10:00:00.000Z", note: null })),
  };
}

describe("wasConfirmed", () => {
  it("counts orders confirmed at any point, including confirmed-then-cancelled", () => {
    expect(wasConfirmed(order("shipped", 1))).toBe(true);
    expect(wasConfirmed(order("returned", 1))).toBe(true);
    expect(wasConfirmed(order("cancelled", 1, ["pending_confirmation", "confirmed", "cancelled"]))).toBe(true);
    expect(wasConfirmed(order("cancelled", 1, ["pending_confirmation", "cancelled"]))).toBe(false);
    expect(wasConfirmed(order("pending_confirmation", 1))).toBe(false);
  });
});

describe("periodMetrics", () => {
  const orders = [
    order("pending_confirmation", 1000),
    order("confirmed", 2000),
    order("shipped", 3000),
    order("delivered", 4000),
    order("delivered", 6000),
    order("refused", 2500),
    order("returned", 1500),
    order("cancelled", 900, ["pending_confirmation", "cancelled"]),
  ];
  const m = periodMetrics(orders);

  it("excludes orders still awaiting confirmation from the confirmation rate", () => {
    expect(m.awaitingConfirmation).toBe(1);
    expect(m.confirmedOrders).toBe(6);
    expect(m.confirmationRatePct).toBe(85.7); // 6 / 7
  });

  it("computes delivery outcomes over completed deliveries", () => {
    expect(m.completedDeliveries).toBe(4);
    expect(m.deliverySuccessRatePct).toBe(50);
    expect(m.returnRatePct).toBe(50);
    expect(m.cancellationRatePct).toBe(12.5);
  });

  it("separates delivered revenue, pipeline and lost value", () => {
    expect(m.deliveredRevenue).toBe(10_000);
    expect(m.averageDeliveredOrderValue).toBe(5000);
    expect(m.pipelineValue).toBe(5000);
    expect(m.lostToReturnsValue).toBe(4000);
    expect(m.waitingForShipment).toBe(1);
    expect(m.inDelivery).toBe(1);
  });

  it("returns null rates (not zero) when there is nothing to measure", () => {
    const empty = periodMetrics([]);
    expect(empty.totalOrders).toBe(0);
    expect(empty.confirmationRatePct).toBeNull();
    expect(empty.returnRatePct).toBeNull();
    expect(empty.averageDeliveredOrderValue).toBeNull();
  });
});

describe("compareMetrics", () => {
  it("reports absolute and relative changes, null when previous is zero", () => {
    const changes = compareMetrics(periodMetrics([order("delivered", 3000), order("delivered", 3000)]), periodMetrics([order("delivered", 4000)]));
    expect(changes.totalOrders).toEqual({ current: 2, previous: 1, change: 1, changePct: 100 });
    expect(changes.deliveredRevenue).toEqual({ current: 6000, previous: 4000, change: 2000, changePct: 50 });
    const fromZero = compareMetrics(periodMetrics([order("delivered", 1)]), periodMetrics([]));
    expect(fromZero.totalOrders!.changePct).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes courier names", () => {
    expect(courierKey(" Yalidine ")).toBe(courierKey("yalidine"));
    expect(courierKey("Zr  Express")).toBe("zr express");
  });

  it("measures shipped → delivered days from status history", () => {
    const o = order("delivered", 1, ["confirmed", "shipped", "delivered"], ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", "2026-11-05T12:00:00Z"]);
    expect(deliveryDays(o)).toBe(3.5);
    expect(deliveryDays(order("shipped", 1))).toBeNull();
  });
});
