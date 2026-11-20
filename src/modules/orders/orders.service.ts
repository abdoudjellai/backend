import { storage } from "../../storage/index.js";
import type { NewRecord } from "../../storage/json-collection.js";
import { AppError } from "../../shared/errors/app-error.js";
import { byCreatedAtDesc, paginate, type Page } from "../../shared/utils/pagination.js";
import type { Customer } from "../customers/customer.model.js";
import type { Product } from "../products/product.model.js";
import type { Order } from "./order.model.js";
import { assertStockAvailable, priceOrderItems } from "./order-pricing.js";
import {
  ADDRESS_EDITABLE_STATUSES,
  assertTransitionAllowed,
  DISPATCH_INFO_EDITABLE_STATUSES,
  ITEMS_EDITABLE_STATUSES,
  missingFieldsFor,
} from "./order-status.js";
import type { CreateOrderInput, ListOrdersQuery, UpdateOrderInput, UpdateOrderStatusInput } from "./orders.validation.js";

/** Product lookup restricted to one store: products of other stores are "not found". */
function storeProductFinder(storeId: string): (productId: string) => Product | undefined {
  return (productId) => storage.products.findOne((p) => p.id === productId && p.storeId === storeId);
}

function getStoreCustomer(storeId: string, customerId: string): Customer {
  const customer = storage.customers.findOne((c) => c.id === customerId && c.storeId === storeId);
  if (customer === undefined) {
    throw AppError.invalidReference("Customer not found in this store", { field: "customerId", customerId });
  }
  return customer;
}

export function listOrders(storeId: string, query: ListOrdersQuery): Page<Order> {
  const from = query.from?.getTime();
  const to = query.to?.getTime();
  const orders = storage.orders
    .findAll((order) => {
      if (order.storeId !== storeId) return false;
      if (query.status !== undefined && order.status !== query.status) return false;
      if (query.customerId !== undefined && order.customerId !== query.customerId) return false;
      const created = Date.parse(order.createdAt);
      return (from === undefined || created >= from) && (to === undefined || created <= to);
    })
    .sort(byCreatedAtDesc);
  return paginate(orders, query.page, query.limit);
}

export function getOrder(storeId: string, orderId: string): Order {
  const order = storage.orders.findOne((o) => o.id === orderId && o.storeId === storeId);
  if (order === undefined) throw AppError.notFound("Order not found");
  return order;
}

/**
 * Create an unconfirmed order. The customer and every product must belong to the store; prices
 * and totals are calculated from the catalog. Delivery fields not provided are copied from the
 * customer. The order is never confirmed or dispatched here.
 */
export async function createOrder(storeId: string, input: CreateOrderInput): Promise<Order> {
  const customer = getStoreCustomer(storeId, input.customerId);
  const { items, totalAmount } = priceOrderItems(input.items, storeProductFinder(storeId));
  const now = new Date().toISOString();

  return storage.orders.create({
    storeId,
    customerId: customer.id,
    items,
    totalAmount,
    currency: "DZD",
    delivery: {
      wilaya: input.delivery.wilaya !== undefined ? input.delivery.wilaya : customer.wilaya,
      address: input.delivery.address !== undefined ? input.delivery.address : customer.address,
      phone: input.delivery.phone !== undefined ? input.delivery.phone : customer.phone,
      company: null,
      trackingNumber: null,
    },
    status: input.status,
    source: input.source,
    notes: input.notes,
    statusHistory: [{ status: input.status, at: now, note: null }],
  });
}

function assertOrderEditable(order: Readonly<Order>, input: UpdateOrderInput): void {
  if ((input.items !== undefined || input.customerId !== undefined) && !ITEMS_EDITABLE_STATUSES.includes(order.status)) {
    throw AppError.businessRule("Items and customer can only be changed while the order is draft or pending_confirmation", {
      status: order.status,
    });
  }
  const delivery = input.delivery ?? {};
  const changesAddress = "wilaya" in delivery || "address" in delivery || "phone" in delivery;
  if (changesAddress && !ADDRESS_EDITABLE_STATUSES.includes(order.status)) {
    throw AppError.businessRule("The delivery address cannot be changed after the order has shipped", {
      status: order.status,
    });
  }
  const changesDispatchInfo = "company" in delivery || "trackingNumber" in delivery;
  if (changesDispatchInfo && !DISPATCH_INFO_EDITABLE_STATUSES.includes(order.status)) {
    throw AppError.businessRule("Courier and tracking number cannot be changed once the order has an outcome", {
      status: order.status,
    });
  }
}

/** Edit an order. New items are re-priced from the current catalog. Status changes use updateOrderStatus. */
export async function updateOrder(storeId: string, orderId: string, input: UpdateOrderInput): Promise<Order> {
  getOrder(storeId, orderId);
  const customer = input.customerId !== undefined ? getStoreCustomer(storeId, input.customerId) : undefined;
  const priced = input.items !== undefined ? priceOrderItems(input.items, storeProductFinder(storeId)) : undefined;

  const updated = await storage.orders.update(orderId, (current) => {
    // Checked against the current record inside the write lock, so a concurrent status change
    // cannot slip an edit past these rules.
    assertOrderEditable(current, input);
    const patch: Partial<NewRecord<Order>> = {};
    if (customer !== undefined) patch.customerId = customer.id;
    if (priced !== undefined) {
      patch.items = priced.items;
      patch.totalAmount = priced.totalAmount;
    }
    if (input.delivery !== undefined) patch.delivery = { ...current.delivery, ...input.delivery };
    if (input.notes !== undefined) patch.notes = input.notes;
    return patch;
  });
  if (updated === undefined) throw AppError.notFound("Order not found");
  return updated;
}

/**
 * Move an order to a new status, following ALLOWED_TRANSITIONS. Confirming requires complete
 * delivery details, chosen product options and available stock; shipping requires a courier.
 * Stock is checked but not deducted.
 */
export async function updateOrderStatus(storeId: string, orderId: string, input: UpdateOrderStatusInput): Promise<Order> {
  getOrder(storeId, orderId);
  const findProduct = storeProductFinder(storeId);

  const updated = await storage.orders.update(orderId, (current) => {
    assertTransitionAllowed(current.status, input.status);

    const products = current.items.map((item) => findProduct(item.productId));
    const missingFields = missingFieldsFor(input.status, {
      items: current.items.map((item, index) => {
        const product = products[index];
        return {
          size: item.size,
          color: item.color,
          ...(product !== undefined
            ? { productOptions: { hasSizes: product.sizes.length > 0, hasColors: product.colors.length > 0 } }
            : {}),
        };
      }),
      delivery: current.delivery,
    });
    if (missingFields.length > 0) {
      throw AppError.businessRule(`Order is missing information required for status ${input.status}`, { missingFields });
    }

    if (input.status === "confirmed") {
      const deleted = current.items.filter((_, index) => products[index] === undefined).map((item) => item.productId);
      if (deleted.length > 0) {
        throw AppError.businessRule("Some products in this order no longer exist", { productIds: deleted });
      }
      const requested = new Map<string, { product: Product; quantity: number }>();
      current.items.forEach((item, index) => {
        const product = products[index] as Product;
        requested.set(product.id, { product, quantity: (requested.get(product.id)?.quantity ?? 0) + item.quantity });
      });
      assertStockAvailable([...requested.values()]);
    }

    return {
      status: input.status,
      statusHistory: [...current.statusHistory, { status: input.status, at: new Date().toISOString(), note: input.note }],
    };
  });
  if (updated === undefined) throw AppError.notFound("Order not found");
  return updated;
}
