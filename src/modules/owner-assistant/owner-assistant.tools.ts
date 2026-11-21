import { z, ZodError } from "zod";
import { logger } from "../../config/logger.js";
import { storage } from "../../storage/index.js";
import { idSchema } from "../../shared/validation/common.js";
import { ORDER_STATUSES } from "../orders/order-status.js";
import type { Order } from "../orders/order.model.js";
import type { Customer } from "../customers/customer.model.js";
import { latestAnalysisPerOrder } from "../analytics/analytics.calculations.js";
import { parseToolArgs } from "../ai/agent-loop.js";
import type { AiToolDef } from "../ai/providers/aigrid.provider.js";
import {
  describePeriod,
  inPeriod,
  periodSpecSchema,
  previousPeriod,
  resolvePeriod,
  sameElapsedSlice,
  toLocalDate,
  ToolInputError,
  type PeriodPreset,
  type ResolvedPeriod,
} from "./owner-assistant.periods.js";
import {
  compareMetrics,
  courierKey,
  deliveryDays,
  groupBy,
  isCompletedDelivery,
  isReturnOutcome,
  outcomeRow,
  pct,
  periodMetrics,
} from "./owner-assistant.metrics.js";

/**
 * Read-only business tools for the owner assistant.
 *
 * Security model:
 * - `storeId` comes only from the authenticated owner (via the service), never from model arguments.
 *   Every query below filters on it.
 * - Arguments are validated with Zod; the same schemas generate the JSON schemas sent to the model.
 * - Customer data is limited to name and wilaya — never phone numbers or addresses.
 * - No tool writes to storage.
 */

export interface OwnerToolContext {
  storeId: string;
  /** Reference time for period resolution (injectable for tests). */
  now: Date;
}

type ToolResult = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const MAX_NOTE_LENGTH = 200;

function storeOrders(ctx: OwnerToolContext, period?: ResolvedPeriod): Order[] {
  return storage.orders.findAll((o) => o.storeId === ctx.storeId && (period === undefined || inPeriod(o.createdAt, period)));
}

function storeCustomers(ctx: OwnerToolContext): Map<string, Customer> {
  return new Map(storage.customers.findAll((c) => c.storeId === ctx.storeId).map((c) => [c.id, c]));
}

/** The only customer fields the assistant may see. */
function customerSummary(customer: Customer | undefined): { name: string; wilaya: string | null } {
  return { name: customer?.name ?? "Unnamed customer", wilaya: customer?.wilaya ?? null };
}

const truncate = (text: string | null): string | null =>
  text === null ? null : text.length <= MAX_NOTE_LENGTH ? text : `${text.slice(0, MAX_NOTE_LENGTH - 1)}…`;

const newestFirst = (a: Order, b: Order): number => b.createdAt.localeCompare(a.createdAt);

function orderRow(order: Order, customers?: Map<string, Customer>): ToolResult {
  return {
    orderId: order.id,
    createdAt: order.createdAt,
    status: order.status,
    source: order.source,
    totalAmount: order.totalAmount,
    currency: order.currency,
    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      lineTotal: item.lineTotal,
    })),
    wilaya: order.delivery.wilaya,
    deliveryCompany: order.delivery.company,
    ...(customers !== undefined ? { customer: customerSummary(customers.get(order.customerId)) } : {}),
  };
}

/** Notes attached to status changes into `statuses` — the owner's recorded reasons. */
function statusNotes(orders: readonly Order[], statuses: readonly string[], limit: number): ToolResult[] {
  const notes: { orderId: string; status: string; at: string; note: string }[] = [];
  for (const order of orders) {
    for (const change of order.statusHistory) {
      if (statuses.includes(change.status) && change.note !== null && change.note.trim() !== "") {
        notes.push({ orderId: order.id, status: change.status, at: change.at, note: truncate(change.note.trim()) ?? "" });
      }
    }
  }
  return notes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function topRows<T extends { orders: number }>(rows: T[], limit: number): T[] {
  return rows.sort((a, b) => b.orders - a.orders).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const limitSchema = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback).describe(`How many rows to return (1-${max}, default ${fallback}).`);

const withPeriod = <S extends z.ZodRawShape>(shape: S) => periodSpecSchema.extend(shape);

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

interface OwnerTool {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (args: never, ctx: OwnerToolContext) => ToolResult;
}

function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  description: string;
  schema: S;
  run: (args: z.output<S>, ctx: OwnerToolContext) => ToolResult;
}): OwnerTool {
  return tool as unknown as OwnerTool;
}

const period = (args: { period?: PeriodPreset | undefined; start?: string | undefined; end?: string | undefined }, ctx: OwnerToolContext, fallback: PeriodPreset) =>
  resolvePeriod(args, ctx.now, fallback);

const TOOLS: OwnerTool[] = [
  defineTool({
    name: "get_business_overview",
    description:
      "Overall business performance for a period (default: this_month): order counts, confirmation/cancellation/return rates, delivered revenue, plus the store's current workload (orders awaiting confirmation, waiting for shipment, in delivery) and catalog/customer totals.",
    schema: periodSpecSchema,
    run: (args, ctx) => {
      const p = period(args, ctx, "this_month");
      const allOrders = storeOrders(ctx);
      const current = periodMetrics(allOrders);
      return {
        period: describePeriod(p),
        metrics: periodMetrics(allOrders.filter((o) => inPeriod(o.createdAt, p))),
        currentWorkload: {
          note: "Current state of all orders, regardless of period.",
          awaitingConfirmation: current.awaitingConfirmation,
          waitingForShipment: current.waitingForShipment,
          inDelivery: current.inDelivery,
        },
        totalCustomers: storage.customers.count((c) => c.storeId === ctx.storeId),
        totalProducts: storage.products.count((p2) => p2.storeId === ctx.storeId),
      };
    },
  }),

  defineTool({
    name: "get_revenue_summary",
    description:
      "Revenue for a period (default: this_month), in DZD. deliveredRevenue counts orders currently delivered; pipelineValue is confirmed orders not yet delivered; lostToReturnsValue is refused/returned orders. Orders are attributed by their creation date. Includes a per-day (periods up to 62 days) or per-month breakdown.",
    schema: periodSpecSchema,
    run: (args, ctx) => {
      const p = period(args, ctx, "this_month");
      const orders = storeOrders(ctx, p);
      const m = periodMetrics(orders);
      const byDay = p.endMs - p.startMs <= 62 * 24 * 60 * 60 * 1000;
      const buckets = groupBy(orders, (o) => toLocalDate(Date.parse(o.createdAt)).slice(0, byDay ? 10 : 7));
      return {
        period: describePeriod(p),
        currency: "DZD",
        deliveredRevenue: m.deliveredRevenue,
        deliveredOrders: m.deliveredOrders,
        averageDeliveredOrderValue: m.averageDeliveredOrderValue,
        pipelineValue: m.pipelineValue,
        lostToReturnsValue: m.lostToReturnsValue,
        cancelledValue: orders.filter((o) => o.status === "cancelled").reduce((s, o) => s + o.totalAmount, 0),
        totalOrders: m.totalOrders,
        breakdownUnit: byDay ? "day" : "month",
        breakdown: [...buckets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([bucket, list]) => {
            const bm = periodMetrics(list);
            return { [byDay ? "date" : "month"]: bucket, orders: bm.totalOrders, deliveredRevenue: bm.deliveredRevenue, pipelineValue: bm.pipelineValue };
          }),
      };
    },
  }),

  defineTool({
    name: "get_orders_summary",
    description:
      "Order counts for a period (default: this_month): by status, awaiting confirmation, waiting for shipment, in delivery, delivered/refused/returned, confirmation, cancellation and return rates, and orders per sales channel. Confirmation rate = orders that were ever confirmed / orders no longer awaiting confirmation.",
    schema: periodSpecSchema,
    run: (args, ctx) => {
      const p = period(args, ctx, "this_month");
      const orders = storeOrders(ctx, p);
      return {
        period: describePeriod(p),
        ...periodMetrics(orders),
        byChannel: Object.fromEntries([...groupBy(orders, (o) => o.source)].map(([source, list]) => [source, list.length])),
      };
    },
  }),

  defineTool({
    name: "get_recent_orders",
    description:
      "The most recent orders, newest first, optionally filtered by status and/or period (default: all_time). Each row has the order ID, items, total, status, wilaya, delivery company and customer name/wilaya.",
    schema: withPeriod({
      limit: limitSchema(20, 10),
      status: z.enum(ORDER_STATUSES).optional().describe("Only orders currently in this status."),
    }),
    run: (args, ctx) => {
      const p = period(args, ctx, "all_time");
      const matching = storeOrders(ctx, p)
        .filter((o) => args.status === undefined || o.status === args.status)
        .sort(newestFirst);
      const customers = storeCustomers(ctx);
      return {
        period: describePeriod(p),
        status: args.status ?? null,
        totalMatching: matching.length,
        returned: Math.min(matching.length, args.limit),
        orders: matching.slice(0, args.limit).map((o) => orderRow(o, customers)),
      };
    },
  }),

  defineTool({
    name: "get_order_details",
    description:
      "Full details of one order by its ID (as returned by get_recent_orders, e.g. order_ab12...): items, totals, status history with notes, delivery wilaya/company/tracking, customer name/wilaya, and the latest AI-predicted return risk if one exists.",
    schema: z.object({ orderId: idSchema.describe("The order ID.") }),
    run: (args, ctx) => {
      const order = storage.orders.findOne((o) => o.id === args.orderId && o.storeId === ctx.storeId);
      if (order === undefined) {
        return { found: false, message: "No order with this ID exists in this store." };
      }
      const analysis = latestAnalysisPerOrder(
        storage.aiAnalytics.findAll((a) => a.orderId === order.id && a.storeId === ctx.storeId),
      )[0];
      return {
        found: true,
        order: {
          ...orderRow(order, storeCustomers(ctx)),
          updatedAt: order.updatedAt,
          trackingNumber: order.delivery.trackingNumber,
          notes: truncate(order.notes),
          statusHistory: order.statusHistory.map((h) => ({ status: h.status, at: h.at, note: truncate(h.note) })),
        },
        predictedRisk:
          analysis === undefined
            ? null
            : {
                note: "AI prediction, not an actual outcome.",
                returnRiskPct: Math.round(analysis.returnRisk * 1000) / 10,
                riskLevel: analysis.riskLevel,
                recommendedCourier: analysis.recommendedCourier,
              },
      };
    },
  }),

  defineTool({
    name: "get_customer_insights",
    description:
      "Customer statistics for a period (default: all_time): customers who ordered, repeat customers (more than one order) and their share, share of orders from repeat customers, new customers, top customers by order count, customers with the highest return rates, and customers per wilaya. Customers are identified by name and wilaya only.",
    schema: withPeriod({ limit: limitSchema(20, 5) }),
    run: (args, ctx) => {
      const p = period(args, ctx, "all_time");
      const customers = storeCustomers(ctx);
      const orders = storeOrders(ctx, p).filter((o) => o.status !== "draft");
      const byCustomer = groupBy(orders, (o) => o.customerId);
      const rows = [...byCustomer.entries()].map(([customerId, list]) => {
        const outcome = outcomeRow(list);
        return {
          customer: customerSummary(customers.get(customerId)),
          orders: list.length,
          deliveredOrders: outcome.delivered,
          deliveredSpend: list.filter((o) => o.status === "delivered").reduce((s, o) => s + o.totalAmount, 0),
          completedDeliveries: outcome.completedDeliveries,
          refusedOrReturned: outcome.refusedOrReturned,
          returnRatePct: outcome.returnRatePct,
        };
      });
      const repeat = rows.filter((r) => r.orders > 1);
      const byWilaya = groupBy(rows, (r) => r.customer.wilaya ?? "unknown");
      return {
        period: describePeriod(p),
        note: "Draft orders are excluded.",
        totalCustomersInStore: customers.size,
        newCustomersInPeriod: [...customers.values()].filter((c) => inPeriod(c.createdAt, p)).length,
        customersWhoOrdered: rows.length,
        repeatCustomers: repeat.length,
        repeatCustomerRatePct: pct(repeat.length, rows.length),
        ordersFromRepeatCustomersPct: pct(
          repeat.reduce((s, r) => s + r.orders, 0),
          orders.length,
        ),
        topCustomers: [...rows].sort((a, b) => b.orders - a.orders || b.deliveredSpend - a.deliveredSpend).slice(0, args.limit),
        highestReturnRates: rows
          .filter((r) => r.refusedOrReturned > 0)
          .sort((a, b) => (b.returnRatePct ?? 0) - (a.returnRatePct ?? 0) || b.refusedOrReturned - a.refusedOrReturned)
          .slice(0, args.limit),
        customersByWilaya: topRows(
          [...byWilaya.entries()].map(([wilaya, list]) => ({ wilaya, customers: list.length, orders: list.reduce((s, r) => s + r.orders, 0) })),
          10,
        ),
      };
    },
  }),

  defineTool({
    name: "get_top_products",
    description:
      "Product performance for a period (default: all_time), from order line items: units ordered (excluding drafts and cancellations), units delivered, delivered revenue, return rate per product, and current catalog price/stock. Sort by revenue (default), delivered_units or ordered_units.",
    schema: withPeriod({
      limit: limitSchema(20, 10),
      sortBy: z.enum(["revenue", "delivered_units", "ordered_units"]).default("revenue").describe("Ranking criterion."),
    }),
    run: (args, ctx) => {
      const p = period(args, ctx, "all_time");
      const orders = storeOrders(ctx, p).filter((o) => o.status !== "draft" && o.status !== "cancelled");
      const lines = orders.flatMap((order) => order.items.map((item) => ({ order, item })));
      const byProduct = groupBy(lines, (l) => l.item.productId);
      const rows = [...byProduct.entries()].map(([productId, list]) => {
        const product = storage.products.findOne((x) => x.id === productId && x.storeId === ctx.storeId);
        const delivered = list.filter((l) => l.order.status === "delivered");
        const completed = list.filter((l) => isCompletedDelivery(l.order));
        const returned = completed.filter((l) => isReturnOutcome(l.order));
        return {
          productName: product?.name ?? list[list.length - 1]?.item.productName ?? "Unknown product",
          inCatalog: product !== undefined,
          orderedUnits: list.reduce((s, l) => s + l.item.quantity, 0),
          deliveredUnits: delivered.reduce((s, l) => s + l.item.quantity, 0),
          deliveredRevenue: delivered.reduce((s, l) => s + l.item.lineTotal, 0),
          returnRatePct: pct(returned.length, completed.length),
          completedDeliveries: completed.length,
          currentPrice: product?.price ?? null,
          currentStock: product?.stock ?? null,
        };
      });
      const key = args.sortBy === "revenue" ? "deliveredRevenue" : args.sortBy === "delivered_units" ? "deliveredUnits" : "orderedUnits";
      return {
        period: describePeriod(p),
        currency: "DZD",
        sortBy: args.sortBy,
        productsWithSales: rows.length,
        products: rows.sort((a, b) => b[key] - a[key] || b.orderedUnits - a.orderedUnits).slice(0, args.limit),
      };
    },
  }),

  defineTool({
    name: "get_return_analysis",
    description:
      "Refusals, returns and cancellations for a period (default: all_time): return rate, value lost, return rate by wilaya, product, sales channel and delivery company, recent refused/returned orders, the owner's recorded reasons (status notes), and how AI return-risk predictions compared with actual outcomes. Rates are over completed deliveries (delivered + refused + returned).",
    schema: periodSpecSchema,
    run: (args, ctx) => {
      const p = period(args, ctx, "all_time");
      const orders = storeOrders(ctx, p);
      const m = periodMetrics(orders);
      const completed = orders.filter(isCompletedDelivery);
      const breakdown = (key: (o: Order) => string) =>
        topRows(
          [...groupBy(completed, key).entries()].map(([value, list]) => ({ value, ...outcomeRow(list) })),
          10,
        ).sort((a, b) => (b.returnRatePct ?? 0) - (a.returnRatePct ?? 0));
      const analyses = latestAnalysisPerOrder(storage.aiAnalytics.findAll((a) => a.storeId === ctx.storeId));
      const orderById = new Map(orders.map((o) => [o.id, o]));
      const analyzedCompleted = analyses.filter((a) => {
        const order = orderById.get(a.orderId);
        return order !== undefined && isCompletedDelivery(order);
      });
      const highRisk = analyzedCompleted.filter((a) => a.riskLevel === "high");
      return {
        period: describePeriod(p),
        currency: "DZD",
        completedDeliveries: m.completedDeliveries,
        delivered: m.deliveredOrders,
        refused: m.refusedOrders,
        returned: m.returnedOrders,
        returnRatePct: m.returnRatePct,
        lostToReturnsValue: m.lostToReturnsValue,
        cancelled: m.cancelledOrders,
        cancellationRatePct: m.cancellationRatePct,
        byWilaya: breakdown((o) => o.delivery.wilaya ?? "unknown"),
        byProduct: breakdown((o) => o.items.map((i) => i.productName).join(" + ") || "unknown"),
        byChannel: breakdown((o) => o.source),
        byDeliveryCompany: breakdown((o) => (o.delivery.company === null ? "not recorded" : courierKey(o.delivery.company))),
        recentRefusedOrReturned: orders.filter(isReturnOutcome).sort(newestFirst).slice(0, 10).map((o) => orderRow(o)),
        recordedReasons: statusNotes(orders, ["refused", "returned", "cancelled"], 15),
        predictionVsOutcome:
          analyzedCompleted.length === 0
            ? null
            : {
                note: "Compares AI predictions with actual outcomes for completed orders that were analyzed.",
                analyzedCompletedOrders: analyzedCompleted.length,
                predictedHighRisk: highRisk.length,
                predictedHighRiskActuallyReturned: highRisk.filter((a) => isReturnOutcome(orderById.get(a.orderId)!)).length,
              },
      };
    },
  }),

  defineTool({
    name: "get_delivery_performance",
    description:
      "Delivery company (courier) performance for a period (default: all_time): orders per courier, in delivery, delivered/refused/returned, success and return rates, average days from shipped to delivered. Courier names are matched case-insensitively. Returns available=false when no order has a delivery company recorded. lowSample=true marks couriers with fewer than 5 completed deliveries.",
    schema: periodSpecSchema,
    run: (args, ctx) => {
      const p = period(args, ctx, "all_time");
      const orders = storeOrders(ctx, p);
      const withCompany = orders.filter((o) => o.delivery.company !== null && o.delivery.company.trim() !== "");
      const shippedOrLater = orders.filter((o) => o.status === "shipped" || isCompletedDelivery(o));
      if (withCompany.length === 0) {
        return {
          period: describePeriod(p),
          available: false,
          reason:
            "No order in this period has a delivery company recorded. The delivery company is entered manually by the owner on each order, so courier performance cannot be measured yet.",
          ordersShippedOrCompleted: shippedOrLater.length,
        };
      }
      const groups = groupBy(withCompany, (o) => courierKey(o.delivery.company!));
      const couriers = [...groups.values()].map((list) => {
        const outcome = outcomeRow(list);
        const days = list.map(deliveryDays).filter((d): d is number => d !== null);
        return {
          company: list[0]!.delivery.company!.trim(),
          orders: list.length,
          inDelivery: list.filter((o) => o.status === "shipped").length,
          delivered: outcome.delivered,
          refusedOrReturned: outcome.refusedOrReturned,
          completedDeliveries: outcome.completedDeliveries,
          successRatePct: pct(outcome.delivered, outcome.completedDeliveries),
          returnRatePct: outcome.returnRatePct,
          averageDeliveryDays: days.length === 0 ? null : Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
          lowSample: outcome.completedDeliveries < 5,
        };
      });
      const overall = outcomeRow(orders.filter(isCompletedDelivery));
      return {
        period: describePeriod(p),
        available: true,
        courierCount: couriers.length,
        inDelivery: orders.filter((o) => o.status === "shipped").length,
        overallSuccessRatePct: pct(overall.delivered, overall.completedDeliveries),
        shippedOrCompletedWithoutCompany: shippedOrLater.filter((o) => o.delivery.company === null || o.delivery.company.trim() === "").length,
        couriers: couriers.sort((a, b) => (b.successRatePct ?? -1) - (a.successRatePct ?? -1) || b.completedDeliveries - a.completedDeliveries),
      };
    },
  }),

  defineTool({
    name: "compare_business_periods",
    description:
      "Compare two periods: orders, confirmation, cancellation, delivery success and return rates, delivered revenue, with absolute and percent changes. 'current' defaults to this_month; 'previous' defaults to the period just before it (e.g. last_month). When the current period is still running, 'previousSameElapsed' also compares against the same number of elapsed days of the previous period — prefer it for fair comparisons.",
    schema: z.object({
      current: periodSpecSchema.optional().describe("The period to analyze. Default: this_month."),
      previous: periodSpecSchema.optional().describe("The period to compare against. Default: the period just before 'current'."),
    }),
    run: (args, ctx) => {
      const current = resolvePeriod(args.current, ctx.now, "this_month");
      const prevExplicit = args.previous !== undefined && (args.previous.period !== undefined || args.previous.start !== undefined);
      const previous = prevExplicit ? resolvePeriod(args.previous, ctx.now, "last_month") : previousPeriod(current);
      const allOrders = storeOrders(ctx);
      const metricsFor = (p: ResolvedPeriod) => periodMetrics(allOrders.filter((o) => inPeriod(o.createdAt, p)));
      const cur = metricsFor(current);
      const prev = metricsFor(previous);
      const slice = prevExplicit ? null : sameElapsedSlice(current, previous);
      const sliceMetrics = slice === null ? null : metricsFor(slice);
      return {
        currency: "DZD",
        current: { period: describePeriod(current), metrics: cur },
        previous: { period: describePeriod(previous), metrics: prev },
        changes: compareMetrics(cur, prev),
        previousSameElapsed:
          slice === null || sliceMetrics === null
            ? null
            : { period: describePeriod(slice), metrics: sliceMetrics, changes: compareMetrics(cur, sliceMetrics) },
      };
    },
  }),
];

/* ------------------------------------------------------------------ */
/* Registry and executor                                               */
/* ------------------------------------------------------------------ */

const REGISTRY = new Map(TOOLS.map((tool) => [tool.name, tool]));

function toToolDef(tool: OwnerTool): AiToolDef {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
}

/** Tool definitions sent to the model. Generated from the Zod schemas that validate the arguments. */
export const OWNER_TOOLS: AiToolDef[] = TOOLS.map(toToolDef);
export const OWNER_TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

/** Models often send `null` for "not specified"; treat it as omitted (recursively for nested periods). */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, dropNulls(v)]),
  );
}

/**
 * Execute an owner tool by name. Never throws: unknown tools, invalid arguments and failures
 * come back as `{ error, message }` objects the model can read and recover from.
 */
export async function executeOwnerTool(name: string, argsJson: string, ctx: OwnerToolContext): Promise<ToolResult> {
  const tool = REGISTRY.get(name);
  if (tool === undefined) {
    return { error: "unknown_tool", message: `Tool "${name}" does not exist.`, availableTools: OWNER_TOOL_NAMES };
  }
  const raw = parseToolArgs(argsJson);
  if ("error" in raw && Object.keys(raw).length === 1 && typeof raw.error === "string") {
    return { error: "invalid_arguments", message: "Tool arguments must be a JSON object." };
  }
  try {
    const args = tool.schema.parse(dropNulls(raw));
    return tool.run(args as never, ctx);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        error: "invalid_arguments",
        message: "Some arguments are invalid. Fix them and call the tool again.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      };
    }
    if (error instanceof ToolInputError) {
      return { error: "invalid_arguments", message: error.message };
    }
    logger.error({ err: error, tool: name }, "Owner tool execution failed");
    return { error: "tool_failed", message: "The data could not be retrieved." };
  }
}
