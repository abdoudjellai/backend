import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../src/storage/index.js";
import { OWNER_TOOLS, executeOwnerTool, type OwnerToolContext } from "../../src/modules/owner-assistant/owner-tools.js";
import type { OrderStatus } from "../../src/modules/orders/order-status.js";

const ctx: OwnerToolContext = { storeId: "store_test" };

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

function makeOrder(overrides: {
  id: string;
  customerId: string;
  status: OrderStatus;
  total: number;
  createdDaysAgo: number;
  wilaya?: string;
  company?: string;
  item?: { name: string; qty: number; price: number };
}): void {
  const item = overrides.item ?? { name: "Shoe", qty: 1, price: overrides.total };
  void storage.orders.create({
    storeId: ctx.storeId,
    customerId: overrides.customerId,
    items: [
      {
        productId: "prod_1",
        productName: item.name,
        size: null,
        color: null,
        quantity: item.qty,
        unitPrice: item.price,
        lineTotal: item.price * item.qty,
      },
    ],
    totalAmount: overrides.total,
    currency: "DZD",
    delivery: { wilaya: overrides.wilaya ?? "Blida", address: "addr", phone: "0550123456", company: overrides.company ?? null, trackingNumber: null },
    status: overrides.status,
    source: "manual",
    notes: null,
    statusHistory: [{ status: overrides.status, at: daysAgo(overrides.createdDaysAgo), note: null }],
  });
}

const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
  executeOwnerTool(name, JSON.stringify(args), ctx) as Promise<Record<string, unknown>>;

beforeAll(async () => {
  await storage.open();
  // Seed deterministic data (the test DATA_DIR is empty at this point).
  const amine = await storage.customers.create({ storeId: ctx.storeId, name: "Amine", phone: "0550111111", wilaya: "Blida", address: "a1", source: "manual", platformCustomerId: null });
  const yacine = await storage.customers.create({ storeId: ctx.storeId, name: "Yacine", phone: "0550222222", wilaya: "Oran", address: "a2", source: "manual", platformCustomerId: null });

  makeOrder({ id: "o1", customerId: amine.id, status: "delivered", total: 5000, createdDaysAgo: 10, item: { name: "Sneaker", qty: 1, price: 5000 } });
  makeOrder({ id: "o2", customerId: amine.id, status: "returned", total: 4500, createdDaysAgo: 5, item: { name: "Sandal", qty: 1, price: 4500 } });
  makeOrder({ id: "o3", customerId: yacine.id, status: "refused", total: 3000, createdDaysAgo: 2, company: "Yalidine", item: { name: "Boot", qty: 1, price: 3000 } });
  makeOrder({ id: "o4", customerId: yacine.id, status: "pending_confirmation", total: 2000, createdDaysAgo: 1 });

  await storage.products.create({ storeId: ctx.storeId, name: "Sneaker", description: null, price: 5000, stock: 10, sizes: [42], colors: ["White"] });
});

afterAll(async () => {
  await storage.close();
});

describe("tool registry", () => {
  it("exposes the 10 documented tools", () => {
    const names = OWNER_TOOLS.map((t) => t.function.name).sort();
    expect(names).toEqual(
      [
        "compare_business_periods",
        "get_business_overview",
        "get_customer_insights",
        "get_delivery_performance",
        "get_order_details",
        "get_orders_summary",
        "get_recent_orders",
        "get_revenue_summary",
        "get_return_analysis",
        "get_top_products",
      ].sort(),
    );
  });

  it("rejects unknown tools", async () => {
    const result = await call("drop_database");
    expect(result.error).toBe("Unknown tool: drop_database");
  });

  it("rejects invalid JSON arguments", async () => {
    const result = await executeOwnerTool("get_business_overview", "{not json", ctx);
    expect(result.error).toBe("Invalid tool arguments");
  });
});

describe("get_business_overview", () => {
  it("summarizes orders, revenue and customers", async () => {
    const result = await call("get_business_overview");
    expect(result.totalOrders).toBe(4);
    expect(result.ordersByStatus).toMatchObject({ delivered: 1, returned: 1, refused: 1, pending_confirmation: 1 });
    expect(result.deliveredRevenue).toBe(5000);
    expect(result.totalCustomers).toBe(2);
    expect(result.currency).toBe("DZD");
  });
});

describe("get_revenue_summary", () => {
  it("computes delivered and confirmed revenue", async () => {
    const result = await call("get_revenue_summary");
    expect(result.deliveredRevenue).toBe(5000);
    expect(result.confirmedRevenue).toBe(5000);
    expect(result.averageDeliveredOrderValue).toBe(5000);
  });
});

describe("get_orders_summary", () => {
  it("groups counts by status and computes derived buckets", async () => {
    const result = await call("get_orders_summary");
    expect(result.totalOrders).toBe(4);
    expect(result.waitingForShipment).toBe(0);
    expect(result.completed).toBe(3);
  });
});

describe("get_recent_orders", () => {
  it("returns the newest orders with limited customer PII", async () => {
    const result = await call("get_recent_orders", { limit: 2 });
    const orders = result.orders as { id: string; customer: { name: string | null; wilaya: string | null } }[];
    expect(orders).toHaveLength(2);
    expect(orders[0]?.id).toBe("o4");
    expect(orders[0]?.customer).toBeDefined();
    expect(JSON.stringify(orders)).not.toContain("0550111111");
    expect(JSON.stringify(orders)).not.toContain("a1");
  });

  it("filters by status", async () => {
    const result = await call("get_recent_orders", { status: "returned" });
    const orders = result.orders as { id: string }[];
    expect(orders).toHaveLength(1);
    expect(orders[0]?.id).toBe("o2");
  });
});

describe("get_order_details", () => {
  it("returns one order with its history", async () => {
    const result = await call("get_order_details", { orderId: "o1" });
    expect(result.found).toBe(true);
    const order = result.order as { id: string; totalAmount: number };
    expect(order.id).toBe("o1");
    expect(order.totalAmount).toBe(5000);
    expect(result.statusHistory).toHaveLength(1);
  });

  it("returns found:false for a foreign or missing order", async () => {
    const result = await call("get_order_details", { orderId: "order_doesnotexist" });
    expect(result.found).toBe(false);
  });
});

describe("get_customer_insights", () => {
  it("computes repeat customers and top customers", async () => {
    const result = await call("get_customer_insights");
    expect(result.totalCustomers).toBe(2);
    expect(result.customersWithOrders).toBe(2);
    expect(result.repeatCustomers).toBe(2);
    const top = result.topCustomers as { customer: { name: string | null }; orderCount: number }[];
    expect(top[0]?.customer.name).toBe("Amine");
    expect(top[0]?.orderCount).toBe(2);
  });
});

describe("get_top_products", () => {
  it("ranks products by units in delivered orders", async () => {
    const result = await call("get_top_products");
    const products = result.products as { name: string; unitsSold: number; revenue: number }[];
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("Sneaker");
    expect(products[0]?.unitsSold).toBe(1);
    expect(products[0]?.revenue).toBe(5000);
  });
});

describe("get_return_analysis", () => {
  it("computes the actual return rate", async () => {
    const result = await call("get_return_analysis");
    expect(result.delivered).toBe(1);
    expect(result.refused).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.completed).toBe(3);
    expect(result.actualReturnRate).toBeCloseTo(2 / 3);
    expect((result.returnRateByWilaya as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("get_delivery_performance", () => {
  it("reports per-company success when company data exists", async () => {
    const result = await call("get_delivery_performance");
    expect(result.available).toBe(true);
    const companies = result.companies as { company: string; orderCount: number }[];
    expect(companies[0]?.company).toBe("Yalidine");
    expect(companies[0]?.orderCount).toBe(1);
  });
});

describe("compare_business_periods", () => {
  it("compares two periods", async () => {
    const result = await call("compare_business_periods", {
      start: daysAgo(30),
      previous: { start: daysAgo(60), end: daysAgo(30) },
    });
    const current = result.current as { totalOrders: number; deliveredRevenue: number };
    const previous = result.previous as { totalOrders: number };
    expect(current.totalOrders).toBe(4);
    expect(current.deliveredRevenue).toBe(5000);
    expect(previous.totalOrders).toBe(0);
  });

  it("fails on an invalid previous period", async () => {
    const result = await call("compare_business_periods", { start: daysAgo(30), previous: { start: "nope" } });
    expect(result.error).toBeDefined();
  });
});

describe("store isolation", () => {
  it("never returns data from other stores", async () => {
    void storage.orders.create({
      storeId: "store_other",
      customerId: "cust_other",
      items: [{ productId: "p", productName: "Other", size: null, color: null, quantity: 1, unitPrice: 999, lineTotal: 999 }],
      totalAmount: 999,
      currency: "DZD",
      delivery: { wilaya: "Oran", address: "x", phone: null, company: null, trackingNumber: null },
      status: "delivered",
      source: "manual",
      notes: null,
      statusHistory: [{ status: "delivered", at: daysAgo(1), note: null }],
    });
    const result = await call("get_business_overview");
    expect(result.totalOrders).toBe(4);
    expect(result.deliveredRevenue).toBe(5000);
  });
});
