import { logger } from "../../../config/logger.js";
import { storage } from "../../../storage/index.js";
import type { Customer } from "../../customers/customer.model.js";
import * as customersService from "../../customers/customers.service.js";
import * as ordersService from "../../orders/orders.service.js";

export interface OrderCreationInput {
  storeId: string;
  telegramUserId: string;
  customerName: string;
  customerPhone: string;
  wilaya: string;
  address: string;
  items: { productId: string; quantity: number; size?: string | number | null; color?: string | null }[];
}

export interface OrderCreationResult {
  success: boolean;
  orderId?: string;
  totalAmount?: number;
  currency?: "DZD";
  error?: string;
}

export async function createOrderFromChat(input: OrderCreationInput): Promise<OrderCreationResult> {
  try {
    let customer = storage.customers.findOne(
      (c: Readonly<Customer>) =>
        c.storeId === input.storeId &&
        c.source === "telegram" &&
        c.platformCustomerId === input.telegramUserId,
    );

    if (customer === undefined) {
      customer = await customersService.createCustomer(input.storeId, {
        name: input.customerName,
        phone: input.customerPhone,
        wilaya: input.wilaya,
        address: input.address,
        source: "telegram",
        platformCustomerId: input.telegramUserId,
      });
    } else {
      customer = await customersService.updateCustomer(input.storeId, customer.id, {
        name: input.customerName,
        phone: input.customerPhone,
        wilaya: input.wilaya,
        address: input.address,
      });
    }

    const order = await ordersService.createOrder(input.storeId, {
      customerId: customer.id,
      items: input.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        size: item.size ?? null,
        color: item.color ?? null,
      })),
      delivery: {
        wilaya: input.wilaya,
        address: input.address,
        phone: input.customerPhone,
      },
      status: "pending_confirmation",
      source: "telegram",
      notes: null,
    });

    logger.info({ orderId: order.id, storeId: input.storeId }, "Order created from Telegram chat");

    return {
      success: true,
      orderId: order.id,
      totalAmount: order.totalAmount,
      currency: "DZD",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, storeId: input.storeId }, "Failed to create order from chat");
    return { success: false, error: message };
  }
}

export const ORDER_CREATION_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "create_order",
    description: "Create a new order after the customer has confirmed. Requires complete customer and delivery details. Only call this AFTER the customer explicitly confirms the order summary.",
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer's full name" },
        customerPhone: { type: "string", description: "Customer's phone number (Algerian format)" },
        wilaya: { type: "string", description: "Delivery wilaya" },
        address: { type: "string", description: "Delivery address" },
        items: {
          type: "array",
          description: "Products to order",
          items: {
            type: "object",
            properties: {
              productId: { type: "string", description: "Product ID from search results" },
              quantity: { type: "number", description: "Number of units" },
              size: { type: "string", description: "Selected size (if applicable)" },
              color: { type: "string", description: "Selected color (if applicable)" },
            },
            required: ["productId", "quantity"],
          },
        },
      },
      required: ["customerName", "customerPhone", "wilaya", "address", "items"],
    },
  },
};
