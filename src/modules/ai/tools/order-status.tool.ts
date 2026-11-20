import { storage } from "../../../storage/index.js";
import type { Customer } from "../../customers/customer.model.js";
import type { Order } from "../../orders/order.model.js";

export interface OrderStatusInput {
  storeId: string;
  telegramUserId: string;
  orderId?: string;
}

export interface OrderStatusResult {
  found: boolean;
  orders: {
    id: string;
    status: string;
    totalAmount: number;
    currency: "DZD";
    items: { productName: string; quantity: number; size: string | number | null; color: string | null }[];
    delivery: { wilaya: string | null; company: string | null; trackingNumber: string | null };
    createdAt: string;
  }[];
}

const MAX_ORDERS = 5;

export function getOrderStatus(input: OrderStatusInput): OrderStatusResult {
  const customer = storage.customers.findOne(
    (c: Readonly<Customer>) =>
      c.storeId === input.storeId &&
      c.source === "telegram" &&
      c.platformCustomerId === input.telegramUserId,
  );

  if (customer === undefined) {
    return { found: false, orders: [] };
  }

  let orders: Order[];
  if (input.orderId !== undefined) {
    const order = storage.orders.findOne(
      (o: Readonly<Order>) =>
        o.id === input.orderId &&
        o.storeId === input.storeId &&
        o.customerId === customer.id,
    );
    orders = order !== undefined ? [order] : [];
  } else {
    orders = storage.orders
      .findAll(
        (o: Readonly<Order>) => o.storeId === input.storeId && o.customerId === customer.id,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ORDERS);
  }

  return {
    found: orders.length > 0,
    orders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      currency: "DZD",
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      })),
      delivery: {
        wilaya: order.delivery.wilaya,
        company: order.delivery.company,
        trackingNumber: order.delivery.trackingNumber,
      },
      createdAt: order.createdAt,
    })),
  };
}

export const ORDER_STATUS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "get_order_status",
    description: "Get the status of the customer's orders. Can look up a specific order by ID, or return their most recent orders.",
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Specific order ID to look up (optional — omit to get recent orders)" },
      },
      required: [],
    },
  },
};
