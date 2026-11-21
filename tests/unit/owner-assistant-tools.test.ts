import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { storage } from "../../src/storage/index.js";
import type { OrderStatus } from "../../src/modules/orders/order-status.js";
import type { Order } from "../../src/modules/orders/order.model.js";
import {
  OWNER_TOOLS,
  OWNER_TOOL_NAMES,
  executeOwnerTool,
  type OwnerToolContext,
} from "../../src/modules/owner-assistant/owner-assistant.tools.js";

// Saturday 2026-11-21, 11:00 Algeria time.
const NOW = new Date("2026-11-21T10:00:00.000Z");
const ctx: OwnerToolContext = { storeId: "store_mine", now: NOW };
const OTHER_STORE = "store_other";

/** Create a record "at" a given time: storage stamps createdAt from the (faked) clock. */
async function at<T>(iso: string, create: () => Promise<T>): Promise<T> {
  vi.setSystemTime(new Date(iso));
  try {
    return await create();
  } finally {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date"] });
  }
}

const ids: Record<string, string> = {};
let sneakerId = "";

async function makeOrder(o: {
  key: string;
  createdAt: string;
  storeId?: string;
  customerId: string;
  status: OrderStatus;
  history?: { status: OrderStatus; at: string; note?: string }[];
  product: { id: string; name: string; price: number };
  company?: string;
  wilaya?: string;
}): Promise<void> {
  const order = await at(o.createdAt, () =>
    storage.orders.create({
      storeId: o.storeId ?? ctx.storeId,
      customerId: o.customerId,
      items: [{ productId: o.product.id, productName: o.product.name, size: 42, color: null, quantity: 1, unitPrice: o.product.price, lineTotal: o.product.price }],
      totalAmount: o.product.price,
      currency: "DZD",
      delivery: { wilaya: o.wilaya ?? "Blida", address: "12 Rue Secrète", phone: "0550999888", company: o.company ?? null, trackingNumber: null },
      status: o.status,
      source: "telegram",
      notes: null,
      statusHistory: (o.history ?? [{ status: o.status, at: o.createdAt }]).map((h) => ({ status: h.status, at: h.at, note: h.note ?? null })),
    } satisfies Omit<Order, "id" | "createdAt" | "updatedAt">),
  );
  ids[o.key] = order.id;
}

const call = async (name: string, args: unknown = {}): Promise<Record<string, any>> =>
  executeOwnerTool(name, typeof args === "string" ? args : JSON.stringify(args), ctx) as Promise<Record<string, any>>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await storage.open();

  const customer = (name: string, createdAt: string, storeId = ctx.storeId) =>
    at(createdAt, () =>
      storage.customers.create({ storeId, name, phone: `0550${Math.floor(100000 + Math.random() * 899999)}`, wilaya: "Blida", address: "Hidden address", source: "telegram", platformCustomerId: null }),
    );
  const amine = await customer("Amine", "2026-10-01T09:00:00Z");
  const yacine = await customer("Yacine", "2026-10-01T09:00:00Z");
  const sara = await customer("Sara", "2026-11-19T09:00:00Z");
  const intruder = await customer("Intruder", "2026-10-01T09:00:00Z", OTHER_STORE);

  const sneaker = await storage.products.create({ storeId: ctx.storeId, name: "Sneaker", description: null, price: 5000, stock: 7, sizes: [42], colors: [] });
  sneakerId = sneaker.id;
  await storage.products.create({ storeId: ctx.storeId, name: "Unused", description: null, price: 100, stock: 1, sizes: [], colors: [] });
  const S = { id: sneaker.id, name: "Sneaker", price: 5000 };
  const S6 = { id: sneaker.id, name: "Sneaker", price: 6000 };
  const sandal = { id: "product_sandal", name: "Sandal", price: 4500 };
  const boot = { id: "product_boot", name: "Boot", price: 3000 };

  await makeOrder({
    key: "octDelivered", createdAt: "2026-10-10T10:00:00Z", customerId: amine.id, status: "delivered", product: S, company: "Yalidine",
    history: [
      { status: "confirmed", at: "2026-10-10T11:00:00Z" },
      { status: "shipped", at: "2026-10-11T10:00:00Z" },
      { status: "delivered", at: "2026-10-13T10:00:00Z" },
    ],
  });
  await makeOrder({
    key: "octReturned", createdAt: "2026-10-20T10:00:00Z", customerId: amine.id, status: "returned", product: sandal, company: " yalidine ", wilaya: "Oran",
    history: [{ status: "shipped", at: "2026-10-21T10:00:00Z" }, { status: "returned", at: "2026-10-25T10:00:00Z", note: "Wrong size" }],
  });
  await makeOrder({
    key: "novRefused", createdAt: "2026-11-05T10:00:00Z", customerId: yacine.id, status: "refused", product: boot, company: "EcoTrack", wilaya: "Oran",
    history: [{ status: "refused", at: "2026-11-07T10:00:00Z", note: "Customer not home" }],
  });
  await makeOrder({ key: "novDelivered", createdAt: "2026-11-18T10:00:00Z", customerId: yacine.id, status: "delivered", product: S6, company: "Yalidine" });
  await makeOrder({ key: "novPending", createdAt: "2026-11-20T10:00:00Z", customerId: sara.id, status: "pending_confirmation", product: S });
  await makeOrder({
    key: "novCancelled", createdAt: "2026-11-21T08:00:00Z", customerId: yacine.id, status: "cancelled", product: { ...S, price: 1000 },
    history: [{ status: "confirmed", at: "2026-11-21T08:10:00Z" }, { status: "cancelled", at: "2026-11-21T08:30:00Z", note: "Changed mind" }],
  });
  // Another business's data — must never appear in any result.
  await makeOrder({ key: "foreign", createdAt: "2026-11-10T10:00:00Z", storeId: OTHER_STORE, customerId: intruder.id, status: "delivered", product: { id: "product_x", name: "Foreign", price: 99_999 }, company: "Yalidine" });
});

afterAll(async () => {
  vi.useRealTimers();
  await storage.close();
});

describe("registry", () => {
  it("exposes exactly the 10 documented tools, with JSON schemas generated from Zod", () => {
    expect(OWNER_TOOL_NAMES).toEqual([
      "get_business_overview",
      "get_revenue_summary",
      "get_orders_summary",
      "get_recent_orders",
      "get_order_details",
      "get_customer_insights",
      "get_top_products",
      "get_return_analysis",
      "get_delivery_performance",
      "compare_business_periods",
    ]);
    for (const tool of OWNER_TOOLS) {
      expect(tool.function.parameters.type).toBe("object");
      expect(tool.function.parameters).not.toHaveProperty("$schema");
    }
    // The advertised period fields are the ones the code reads (regression: start/end vs from/to).
    const overview = OWNER_TOOLS.find((t) => t.function.name === "get_business_overview")!;
    expect(Object.keys(overview.function.parameters.properties as object)).toEqual(["period", "start", "end"]);
  });

  it("rejects unknown tools without executing anything", async () => {
    const result = await call("delete_all_orders");
    expect(result.error).toBe("unknown_tool");
    expect(result.availableTools).toContain("get_business_overview");
  });

  it("rejects malformed JSON and invalid arguments with readable issues", async () => {
    expect((await call("get_orders_summary", "{not json")).error).toBe("invalid_arguments");
    expect((await call("get_orders_summary", "[1,2]")).error).toBe("invalid_arguments");
    const bad = await call("get_orders_summary", { period: "next_century" });
    expect(bad.error).toBe("invalid_arguments");
    expect(bad.issues[0].path).toBe("period");
    expect((await call("get_orders_summary", { start: "2026-02-31" })).error).toBe("invalid_arguments");
    expect((await call("get_recent_orders", { limit: 500 })).error).toBe("invalid_arguments");
  });

  it("treats null arguments and empty argument strings as omitted", async () => {
    expect((await call("get_orders_summary", { period: null, start: null })).period.label).toBe("This month");
    expect((await call("get_orders_summary", "")).period.label).toBe("This month");
  });
});

describe("get_business_overview", () => {
  it("defaults to this month and reports the corrected rates", async () => {
    const r = await call("get_business_overview");
    expect(r.period).toMatchObject({ label: "This month", from: "2026-11-01", to: "2026-11-21", isPartial: true });
    expect(r.metrics.totalOrders).toBe(4);
    expect(r.metrics.confirmedOrders).toBe(3); // refused, delivered, confirmed-then-cancelled
    expect(r.metrics.confirmationRatePct).toBe(100); // 3 of the 3 that left confirmation
    expect(r.metrics.deliveredRevenue).toBe(6000);
    expect(r.metrics.returnRatePct).toBe(50);
    expect(r.currentWorkload.awaitingConfirmation).toBe(1);
    expect(r.totalCustomers).toBe(3);
    expect(r.totalProducts).toBe(2);
  });

  it("honours the requested period (regression: periods used to be ignored)", async () => {
    expect((await call("get_business_overview", { period: "last_month" })).metrics.totalOrders).toBe(2);
    expect((await call("get_business_overview", { period: "all_time" })).metrics.totalOrders).toBe(6);
    expect((await call("get_business_overview", { start: "2026-11-18", end: "2026-11-18" })).metrics.totalOrders).toBe(1);
  });
});

describe("get_revenue_summary", () => {
  it("summarizes last month's revenue and losses with a daily breakdown", async () => {
    const r = await call("get_revenue_summary", { period: "last_month" });
    expect(r.deliveredRevenue).toBe(5000);
    expect(r.lostToReturnsValue).toBe(4500);
    expect(r.breakdownUnit).toBe("day");
    expect(r.breakdown).toEqual([
      { date: "2026-10-10", orders: 1, deliveredRevenue: 5000, pipelineValue: 0 },
      { date: "2026-10-20", orders: 1, deliveredRevenue: 0, pipelineValue: 0 },
    ]);
  });

  it("uses a monthly breakdown for long periods", async () => {
    const r = await call("get_revenue_summary", { period: "this_year" });
    expect(r.breakdownUnit).toBe("month");
    expect(r.breakdown.map((b: { month: string }) => b.month)).toEqual(["2026-10", "2026-11"]);
    expect(r.deliveredRevenue).toBe(11_000);
  });
});

describe("get_orders_summary", () => {
  it("counts by status and channel for a custom period", async () => {
    const r = await call("get_orders_summary", { start: "2026-10-01", end: "2026-10-31" });
    expect(r.totalOrders).toBe(2);
    expect(r.ordersByStatus.delivered).toBe(1);
    expect(r.ordersByStatus.returned).toBe(1);
    expect(r.byChannel).toEqual({ telegram: 2 });
  });
});

describe("get_recent_orders", () => {
  it("returns the newest orders first, coercing a string limit", async () => {
    const r = await call("get_recent_orders", { limit: "2" });
    expect(r.returned).toBe(2);
    expect(r.totalMatching).toBe(6);
    expect(r.orders.map((o: { orderId: string }) => o.orderId)).toEqual([ids.novCancelled, ids.novPending]);
    expect(r.orders[0].customer).toEqual({ name: "Yacine", wilaya: "Blida" });
  });

  it("filters by status", async () => {
    const r = await call("get_recent_orders", { status: "delivered" });
    expect(r.orders.map((o: { orderId: string }) => o.orderId)).toEqual([ids.novDelivered, ids.octDelivered]);
  });
});

describe("get_order_details", () => {
  it("returns one order with its status history", async () => {
    const r = await call("get_order_details", { orderId: ids.octReturned });
    expect(r.found).toBe(true);
    expect(r.order.statusHistory.map((h: { status: string }) => h.status)).toEqual(["shipped", "returned"]);
    expect(r.order.statusHistory[1].note).toBe("Wrong size");
    expect(r.predictedRisk).toBeNull();
  });

  it("does not reveal orders of another store", async () => {
    const r = await call("get_order_details", { orderId: ids.foreign });
    expect(r).toEqual({ found: false, message: "No order with this ID exists in this store." });
  });
});

describe("get_customer_insights", () => {
  it("computes repeat customers as a share of customers who ordered", async () => {
    const r = await call("get_customer_insights");
    expect(r.customersWhoOrdered).toBe(3);
    expect(r.repeatCustomers).toBe(2); // Amine (2), Yacine (3); Sara (1)
    expect(r.repeatCustomerRatePct).toBe(66.7);
    expect(r.ordersFromRepeatCustomersPct).toBe(83.3); // 5 of 6
    expect(r.topCustomers[0]).toMatchObject({ customer: { name: "Yacine" }, orders: 3, deliveredSpend: 6000 });
    expect(r.highestReturnRates.map((c: { customer: { name: string } }) => c.customer.name).sort()).toEqual(["Amine", "Yacine"]);
  });

  it("counts new customers in the period", async () => {
    expect((await call("get_customer_insights", { period: "this_week" })).newCustomersInPeriod).toBe(1);
  });
});

describe("get_top_products", () => {
  it("ranks by delivered revenue using order snapshots and catalog data", async () => {
    const r = await call("get_top_products");
    expect(r.products[0]).toMatchObject({ productName: "Sneaker", inCatalog: true, deliveredUnits: 2, deliveredRevenue: 11_000, orderedUnits: 3, currentStock: 7 });
    const sandal = r.products.find((p: { productName: string }) => p.productName === "Sandal");
    expect(sandal).toMatchObject({ inCatalog: false, returnRatePct: 100 });
  });

  it("sorts by ordered units when asked", async () => {
    const r = await call("get_top_products", { sortBy: "ordered_units", limit: 1 });
    expect(r.products).toHaveLength(1);
    expect(r.products[0].productName).toBe("Sneaker");
  });
});

describe("get_return_analysis", () => {
  it("reports return rates, breakdowns and the owner's recorded reasons", async () => {
    const r = await call("get_return_analysis");
    expect(r.completedDeliveries).toBe(4);
    expect(r.returnRatePct).toBe(50);
    expect(r.lostToReturnsValue).toBe(7500);
    expect(r.byWilaya.find((w: { value: string }) => w.value === "Oran")).toMatchObject({ completedDeliveries: 2, returnRatePct: 100 });
    expect(r.byDeliveryCompany.find((c: { value: string }) => c.value === "yalidine")).toMatchObject({ completedDeliveries: 3, returnRatePct: 33.3 });
    expect(r.recordedReasons.map((n: { note: string }) => n.note)).toEqual(["Changed mind", "Customer not home", "Wrong size"]);
    expect(r.recentRefusedOrReturned[0]).not.toHaveProperty("customer");
  });
});

describe("get_delivery_performance", () => {
  it("merges courier names case-insensitively and computes success and delivery time", async () => {
    const r = await call("get_delivery_performance");
    expect(r.available).toBe(true);
    expect(r.courierCount).toBe(2);
    const yalidine = r.couriers.find((c: { company: string }) => c.company === "Yalidine");
    expect(yalidine).toMatchObject({ orders: 3, delivered: 2, refusedOrReturned: 1, successRatePct: 66.7, averageDeliveryDays: 2, lowSample: true });
    expect(r.couriers.find((c: { company: string }) => c.company === "EcoTrack")).toMatchObject({ successRatePct: 0 });
  });

  it("says data is unavailable instead of inventing it", async () => {
    const r = await call("get_delivery_performance", { start: "2026-11-20", end: "2026-11-21" });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/delivery company/i);
  });
});

describe("compare_business_periods", () => {
  it("defaults to this month vs last month, with a same-elapsed-days slice", async () => {
    const r = await call("compare_business_periods");
    expect(r.current.period.label).toBe("This month");
    expect(r.previous.period).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(r.changes.totalOrders).toEqual({ current: 4, previous: 2, change: 2, changePct: 100 });
    expect(r.changes.deliveredRevenue).toMatchObject({ current: 6000, previous: 5000, change: 1000, changePct: 20 });
    expect(r.previousSameElapsed.period).toMatchObject({ from: "2026-10-01", to: "2026-10-21" });
    expect(r.previousSameElapsed.metrics.totalOrders).toBe(2);
  });

  it("accepts explicit periods and rejects all_time without a comparison", async () => {
    const r = await call("compare_business_periods", { current: { period: "last_month" }, previous: { start: "2026-09-01", end: "2026-09-30" } });
    expect(r.previous.metrics.totalOrders).toBe(0);
    expect(r.changes.totalOrders.changePct).toBeNull();
    expect(r.previousSameElapsed).toBeNull();
    expect((await call("compare_business_periods", { current: { period: "all_time" } })).error).toBe("invalid_arguments");
  });
});

describe("data protection", () => {
  it("never returns another store's data or customer phone numbers and addresses", async () => {
    const results = await Promise.all([
      call("get_business_overview", { period: "all_time" }),
      call("get_revenue_summary", { period: "all_time" }),
      call("get_orders_summary", { period: "all_time" }),
      call("get_recent_orders", { limit: 20 }),
      call("get_order_details", { orderId: ids.novDelivered }),
      call("get_customer_insights", { limit: 20 }),
      call("get_top_products", { limit: 20 }),
      call("get_return_analysis"),
      call("get_delivery_performance"),
      call("compare_business_periods", { current: { period: "this_year" } }),
    ]);
    for (const result of results) {
      expect(result.error).toBeUndefined();
      const json = JSON.stringify(result);
      expect(json).not.toContain("Intruder");
      expect(json).not.toContain("99999");
      expect(json).not.toContain(ids.foreign);
      expect(json).not.toContain("0550");
      expect(json).not.toContain("Rue Secrète");
      expect(json).not.toContain("Hidden address");
    }
    expect(sneakerId).not.toBe("");
  });
});
