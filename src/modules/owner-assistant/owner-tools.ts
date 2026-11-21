import { logger } from "../../config/logger.js";
import { storage } from "../../storage/index.js";
import type { Order } from "../orders/order.model.js";
import type { Customer } from "../customers/customer.model.js";
import { ORDER_STATUSES, type OrderStatus } from "../orders/order-status.js";
import { businessStats, deliveryOutcomes, countByStatus } from "../analytics/analytics.calculations.js";
import { parseToolArgs } from "../ai/agent-loop.js";
import type { AiToolDef } from "../ai/providers/aigrid.provider.js";

export interface OwnerToolContext {
  storeId: string;
}

interface Period {
  start: string;
  end: string;
}

type AnyRecord = Record<string, unknown>;

const round = (value: number, decimals = 4): number => Math.round(value * 10 ** decimals) / 10 ** decimals;

function inPeriod(createdAt: string, period: Period): boolean {
  const time = Date.parse(createdAt);
  return time >= Date.parse(period.start) && time <= Date.parse(period.end);
}

function resolvePeriod(args: AnyRecord): Period {
  const from = args.from;
  const to = args.to;
  if (from !== undefined && (typeof from !== "string" || Number.isNaN(Date.parse(from)))) {
    throw new Error("Invalid period.start (expected ISO date)");
  }
  if (to !== undefined && (typeof to !== "string" || Number.isNaN(Date.parse(to)))) {
    throw new Error("Invalid period.end (expected ISO date)");
  }
  const start = typeof from === "string" ? from : "1970-01-01T00:00:00.000Z";
  const end = typeof to === "string" ? to : new Date().toISOString();
  return { start, end };
}

function storeOrders(storeId: string, period?: Period): Order[] {
  return storage.orders.findAll((o) => o.storeId === storeId && (period === undefined || inPeriod(o.createdAt, period)));
}

/** Customer info limited to what an assistant may share: name and wilaya. */
function customerSummary(customer: Customer | undefined): { name: string | null; wilaya: string | null } | null {
  if (customer === undefined) return null;
  return { name: customer.name, wilaya: customer.wilaya };
}

function publicOrder(order: Order, includeCustomer: boolean): AnyRecord {
  const customer = includeCustomer
    ? customerSummary(storage.customers.findOne((c) => c.id === order.customerId && c.storeId === order.storeId))
    : null;
  return {
    id: order.id,
    createdAt: order.createdAt,
    status: order.status,
    source: order.source,
    totalAmount: order.totalAmount,
    currency: order.currency,
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      lineTotal: item.lineTotal,
    })),
    delivery: { wilaya: order.delivery.wilaya, company: order.delivery.company },
    ...(customer !== null ? { customer } : {}),
  };
}

function publicOrders(orders: Order[], limit: number, includeCustomer: boolean): AnyRecord[] {
  return orders
    .slice(0, limit)
    .map((order) => publicOrder(order, includeCustomer));
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

function getBusinessOverview(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const period = resolvePeriod(args);
  const orders = storeOrders(ctx.storeId, period);
  const stats = businessStats(
    orders,
    storage.customers.count((c) => c.storeId === ctx.storeId),
    storage.products.count((p) => p.storeId === ctx.storeId),
  );
  const outcomes = deliveryOutcomes(orders);
  return {
    period,
    totalOrders: stats.totalOrders,
    ordersByStatus: stats.ordersByStatus,
    confirmedOrders: countByStatus(orders).confirmed,
    deliveredRevenue: stats.deliveredRevenue,
    currency: "DZD",
    outcomes: { delivered: outcomes.delivered, refused: outcomes.refused, returned: outcomes.returned, completed: outcomes.completed, actualReturnRate: outcomes.actualReturnRate },
    totalCustomers: stats.totalCustomers,
    totalProducts: stats.totalProducts,
  };
}

function getRevenueSummary(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const period = resolvePeriod(args);
  const orders = storeOrders(ctx.storeId, period);
  const delivered = orders.filter((o) => o.status === "delivered");
  const confirmed = orders.filter((o) => o.status === "confirmed" || o.status === "delivered");
  const deliveredRevenue = delivered.reduce((sum, o) => sum + o.totalAmount, 0);
  const confirmedRevenue = confirmed.reduce((sum, o) => sum + o.totalAmount, 0);
  return {
    period,
    currency: "DZD",
    /** Revenue of orders actually delivered. */
    deliveredRevenue,
    /** Revenue of confirmed-or-delivered orders (includes not-yet-delivered confirmed orders). */
    confirmedRevenue,
    deliveredOrderCount: delivered.length,
    averageDeliveredOrderValue: delivered.length === 0 ? null : round(deliveredRevenue / delivered.length, 2),
    orderCount: orders.length,
  };
}

function getOrdersSummary(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const period = resolvePeriod(args);
  const orders = storeOrders(ctx.storeId, period);
  const byStatus = countByStatus(orders);
  return {
    period,
    totalOrders: orders.length,
    ordersByStatus: byStatus,
    waitingForShipment: byStatus.confirmed + byStatus.pending_dispatch,
    inDelivery: byStatus.shipped,
    completed: byStatus.delivered + byStatus.refused + byStatus.returned,
  };
}

function getRecentOrders(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 20) : 10;
  const status = typeof args.status === "string" && (ORDER_STATUSES as readonly string[]).includes(args.status) ? (args.status as OrderStatus) : undefined;
  const orders = storeOrders(ctx.storeId)
    .filter((o) => status === undefined || o.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    limit,
    status: status ?? null,
    count: publicOrders(orders, limit, true).length,
    orders: publicOrders(orders, limit, true),
  };
}

function getOrderDetails(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const orderId = typeof args.orderId === "string" ? args.orderId : "";
  const order = storage.orders.findOne((o) => o.id === orderId && o.storeId === ctx.storeId);
  if (order === undefined) {
    return { found: false, error: "Order not found in this store" };
  }
  const statusHistory = order.statusHistory.map((h) => ({ status: h.status, at: h.at }));
  return { found: true, order: publicOrder(order, true), statusHistory };
}

function getCustomerInsights(_args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const customers = storage.customers.findAll((c) => c.storeId === ctx.storeId);
  const orders = storeOrders(ctx.storeId);
  const ordersByCustomer = new Map<string, Order[]>();
  for (const order of orders) {
    const list = ordersByCustomer.get(order.customerId) ?? [];
    list.push(order);
    ordersByCustomer.set(order.customerId, list);
  }
  const withOrders = [...ordersByCustomer.entries()].filter(([, list]) => list.length > 0);
  const repeatCustomers = withOrders.filter(([, list]) => list.length > 1).length;
  const customerReturnRate = (customerId: string): number | null => {
    const list = ordersByCustomer.get(customerId) ?? [];
    const completed = list.filter((o) => o.status === "delivered" || o.status === "refused" || o.status === "returned");
    if (completed.length === 0) return null;
    return round(completed.filter((o) => o.status === "refused" || o.status === "returned").length / completed.length);
  };
  const top = withOrders
    .map(([customerId, list]) => {
      const customer = customers.find((c) => c.id === customerId);
      return {
        customer: customerSummary(customer),
        orderCount: list.length,
        totalSpent: list.filter((o) => o.status === "delivered").reduce((sum, o) => sum + o.totalAmount, 0),
        returnRate: customerReturnRate(customerId),
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10);
  const highReturn = withOrders
    .map(([customerId]) => {
      const customer = customers.find((c) => c.id === customerId);
      return { customer: customerSummary(customer), returnRate: customerReturnRate(customerId) };
    })
    .filter((entry): entry is { customer: { name: string | null; wilaya: string | null }; returnRate: number } => entry.returnRate !== null)
    .sort((a, b) => b.returnRate - a.returnRate)
    .slice(0, 5);
  return {
    totalCustomers: customers.length,
    customersWithOrders: withOrders.length,
    repeatCustomers,
    repeatCustomerRate: customers.length === 0 ? null : round(withOrders.length / customers.length),
    topCustomers: top,
    highestReturnRates: highReturn,
  };
}

function getTopProducts(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 20) : 10;
  const orders = storeOrders(ctx.storeId).filter((o) => o.status === "delivered");
  const units = new Map<string, number>();
  const revenue = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
      revenue.set(item.productId, (revenue.get(item.productId) ?? 0) + item.lineTotal);
    }
  }
  const rows = [...units.entries()]
    .map(([productId, qty]) => {
      const product = storage.products.findOne((p) => p.id === productId && p.storeId === ctx.storeId);
      return {
        productId,
        name: product !== undefined ? product.name : "unknown",
        unitsSold: qty,
        revenue: revenue.get(productId) ?? 0,
        currentPrice: product !== undefined ? product.price : null,
      };
    })
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, limit);
  return { period: { start: null, end: null }, note: "Based on delivered orders only.", products: rows };
}

function getReturnAnalysis(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const period = resolvePeriod(args);
  const orders = storeOrders(ctx.storeId, period);
  const outcomes = deliveryOutcomes(orders);
  const returned = orders.filter((o) => o.status === "returned" || o.status === "refused");
  const byWilaya = new Map<string, { returned: number; total: number }>();
  for (const order of orders) {
    const wilaya = order.delivery.wilaya ?? "unknown";
    const entry = byWilaya.get(wilaya) ?? { returned: 0, total: 0 };
    entry.total += 1;
    if (order.status === "returned" || order.status === "refused") entry.returned += 1;
    byWilaya.set(wilaya, entry);
  }
  const wilayaRates = [...byWilaya.entries()]
    .map(([wilaya, entry]) => ({ wilaya, returned: entry.returned, total: entry.total, rate: round(entry.returned / entry.total) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);
  return {
    period,
    totalOrders: orders.length,
    delivered: outcomes.delivered,
    refused: outcomes.refused,
    returned: outcomes.returned,
    completed: outcomes.completed,
    actualReturnRate: outcomes.actualReturnRate,
    returnedOrders: publicOrders(
      returned.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      10,
      false,
    ),
    returnRateByWilaya: wilayaRates,
  };
}

function getDeliveryPerformance(ctx: OwnerToolContext): AnyRecord {
  const orders = storeOrders(ctx.storeId);
  const withCompany = orders.filter((o) => o.delivery.company !== null);
  if (withCompany.length === 0) {
    return {
      available: false,
      reason:
        "No orders have a delivery company recorded yet. Delivery companies are set manually on each order, so company performance cannot be calculated yet.",
      companyCount: 0,
    };
  }
  const byCompany = new Map<string, Order[]>();
  for (const order of withCompany) {
    const list = byCompany.get(order.delivery.company as string) ?? [];
    list.push(order);
    byCompany.set(order.delivery.company as string, list);
  }
  const companies = [...byCompany.entries()]
    .map(([company, list]) => {
      const outcomes = deliveryOutcomes(list);
      return {
        company,
        orderCount: list.length,
        delivered: outcomes.delivered,
        refused: outcomes.refused,
        returned: outcomes.returned,
        successRate: outcomes.completed === 0 ? null : round(outcomes.delivered / outcomes.completed),
      };
    })
    .sort((a, b) => (b.successRate ?? -1) - (a.successRate ?? -1));
  const inDelivery = orders.filter((o) => o.status === "shipped").length;
  const overall = deliveryOutcomes(orders);
  return {
    available: true,
    companyCount: companies.length,
    inDelivery,
    overallSuccessRate: overall.completed === 0 ? null : round(overall.delivered / overall.completed),
    companies,
  };
}

function compareBusinessPeriods(args: AnyRecord, ctx: OwnerToolContext): AnyRecord {
  const current = resolvePeriod(args);
  const previousRaw = args.previous;
  if (typeof previousRaw !== "object" || previousRaw === null) {
    throw new Error("Invalid previous period (expected { start, end })");
  }
  const prev = previousRaw as AnyRecord;
  if (typeof prev.start !== "string" || Number.isNaN(Date.parse(prev.start)) || typeof prev.end !== "string" || Number.isNaN(Date.parse(prev.end))) {
    throw new Error("Invalid previous period (expected { start, end } with ISO dates)");
  }
  const summary = (period: Period) => {
    const orders = storeOrders(ctx.storeId, period);
    const byStatus = countByStatus(orders);
    const delivered = orders.filter((o) => o.status === "delivered").reduce((sum, o) => sum + o.totalAmount, 0);
    return {
      period,
      totalOrders: orders.length,
      deliveredRevenue: delivered,
      ordersByStatus: byStatus,
      confirmationRate: orders.length === 0 ? null : round((byStatus.confirmed + byStatus.delivered) / orders.length),
      outcomes: deliveryOutcomes(orders),
    };
  };
  return {
    currency: "DZD",
    current: summary(current),
    previous: summary(prev as unknown as Period),
  };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const periodParams = {
  type: "object",
  properties: {
    start: { type: "string", description: "Period start, ISO date (e.g. 2026-11-01). Defaults to the beginning of time." },
    end: { type: "string", description: "Period end, ISO date (e.g. 2026-11-30). Defaults to now." },
  },
  additionalProperties: false,
};

const TOOLS: { def: AiToolDef; run: (args: AnyRecord, ctx: OwnerToolContext) => AnyRecord }[] = [
  {
    def: {
      type: "function",
      function: {
        name: "get_business_overview",
        description: "General business statistics for a period: order counts by status, delivered revenue, customers, products, delivery outcomes.",
        parameters: periodParams,
      },
    },
    run: getBusinessOverview,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_revenue_summary",
        description: "Revenue for a period: delivered revenue, confirmed revenue, average delivered order value. All amounts in DZD.",
        parameters: periodParams,
      },
    },
    run: getRevenueSummary,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_orders_summary",
        description: "Order counts grouped by status for a period, plus counts waiting for shipment, in delivery, and completed.",
        parameters: periodParams,
      },
    },
    run: getOrdersSummary,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_recent_orders",
        description: "The most recent orders, newest first. Optionally filtered by status. Customer details are limited to name and wilaya.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "How many orders to return (1-20, default 10)." },
            status: { type: "string", description: "Optional status filter: draft, pending_confirmation, confirmed, pending_dispatch, shipped, delivered, refused, returned, cancelled." },
          },
          additionalProperties: false,
        },
      },
    },
    run: getRecentOrders,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_order_details",
        description: "Full details of one order by its ID, including items, total, delivery wilaya and status history.",
        parameters: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "The order ID." },
          },
          required: ["orderId"],
          additionalProperties: false,
        },
      },
    },
    run: getOrderDetails,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_customer_insights",
        description: "Customer statistics: totals, repeat customers, top customers by order count, and highest customer return rates.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    run: getCustomerInsights,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_top_products",
        description: "Best-performing products by units sold in delivered orders, with revenue per product.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "How many products to return (1-20, default 10)." },
          },
          additionalProperties: false,
        },
      },
    },
    run: getTopProducts,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_return_analysis",
        description: "Return and refusal analysis for a period: actual return rate, returned order list, and return rate by wilaya.",
        parameters: periodParams,
      },
    },
    run: getReturnAnalysis,
  },
  {
    def: {
      type: "function",
      function: {
        name: "get_delivery_performance",
        description: "Delivery company performance: success rate per company, orders still in delivery. Returns available=false when no orders have a delivery company set.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    run: (_args, ctx) => getDeliveryPerformance(ctx),
  },
  {
    def: {
      type: "function",
      function: {
        name: "compare_business_periods",
        description: "Compare two periods of business activity: order counts, delivered revenue, confirmation rate and delivery outcomes.",
        parameters: {
          type: "object",
          properties: {
            start: { type: "string", description: "Current period start, ISO date." },
            end: { type: "string", description: "Current period end, ISO date (defaults to now)." },
            previous: {
              type: "object",
              description: "The previous period to compare against.",
              properties: {
                start: { type: "string", description: "Previous period start, ISO date." },
                end: { type: "string", description: "Previous period end, ISO date." },
              },
              required: ["start", "end"],
              additionalProperties: false,
            },
          },
          required: ["start", "previous"],
          additionalProperties: false,
        },
      },
    },
    run: compareBusinessPeriods,
  },
];

export const OWNER_TOOLS: AiToolDef[] = TOOLS.map((t) => t.def);

const RUNNERS: Record<string, (args: AnyRecord, ctx: OwnerToolContext) => AnyRecord> = Object.fromEntries(
  TOOLS.map((t) => [t.def.function.name, t.run]),
);

/** Execute an owner tool by name. Unknown names and invalid arguments return an error object. */
export async function executeOwnerTool(name: string, argsJson: string, ctx: OwnerToolContext): Promise<AnyRecord> {
  const runner = RUNNERS[name];
  if (runner === undefined) {
    return { error: `Unknown tool: ${name}` };
  }
  const args = parseToolArgs(argsJson);
  if ("error" in args) return args;
  try {
    return runner(args, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    logger.error({ err: error, tool: name }, "Owner tool execution failed");
    return { error: message };
  }
}
