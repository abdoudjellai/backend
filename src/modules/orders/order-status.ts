import { AppError } from "../../shared/errors/app-error.js";
import { ErrorCodes } from "../../shared/constants/error-codes.js";

export const ORDER_STATUSES = [
  "draft",
  "pending_confirmation",
  "confirmed",
  "pending_dispatch",
  "shipped",
  "delivered",
  "refused",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * New orders always start unconfirmed. Extracting an order (by AI or by hand) is not the
 * customer's confirmation, and creating an order never dispatches it.
 */
export const INITIAL_STATUSES = ["draft", "pending_confirmation"] as const satisfies readonly OrderStatus[];

/** Items and customer can only change before the order is confirmed. */
export const ITEMS_EDITABLE_STATUSES: readonly OrderStatus[] = ["draft", "pending_confirmation"];

/** Delivery address can change until the parcel ships. */
export const ADDRESS_EDITABLE_STATUSES: readonly OrderStatus[] = [
  "draft",
  "pending_confirmation",
  "confirmed",
  "pending_dispatch",
];

/** Courier and tracking number can change until the order reaches an outcome. */
export const DISPATCH_INFO_EDITABLE_STATUSES: readonly OrderStatus[] = [...ADDRESS_EDITABLE_STATUSES, "shipped"];

/**
 * Allowed status changes. Every transition is an explicit owner action through the API;
 * nothing moves an order forward automatically.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["pending_confirmation", "cancelled"],
  pending_confirmation: ["draft", "confirmed", "cancelled"],
  confirmed: ["pending_dispatch", "cancelled"],
  pending_dispatch: ["confirmed", "shipped", "cancelled"],
  shipped: ["delivered", "refused", "returned"],
  delivered: ["returned"],
  refused: ["returned"],
  returned: [],
  cancelled: [],
};

export function assertTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw new AppError(409, ErrorCodes.INVALID_STATUS_TRANSITION, `Order is already ${to}`, { from, to });
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(409, ErrorCodes.INVALID_STATUS_TRANSITION, `Cannot change order status from ${from} to ${to}`, {
      from,
      to,
      allowed,
    });
  }
}

/** Minimal order shape needed to check readiness (kept small so it is easy to unit test). */
export interface StatusCheckOrder {
  items: { size: unknown; color: unknown; productOptions?: { hasSizes: boolean; hasColors: boolean } }[];
  delivery: { wilaya: string | null; address: string | null; phone: string | null; company: string | null };
}

const STATUSES_REQUIRING_DELIVERY_ADDRESS: readonly OrderStatus[] = ["confirmed", "pending_dispatch", "shipped"];

/**
 * Fields that must be filled before an order may enter `to`. An empty list means it is ready.
 * - confirmed / pending_dispatch / shipped: complete delivery address and phone,
 *   and a size/color on every item whose product offers those options.
 * - shipped: a delivery company.
 */
export function missingFieldsFor(to: OrderStatus, order: StatusCheckOrder): string[] {
  const missing: string[] = [];
  if (STATUSES_REQUIRING_DELIVERY_ADDRESS.includes(to)) {
    for (const field of ["wilaya", "address", "phone"] as const) {
      if (order.delivery[field] === null) missing.push(`delivery.${field}`);
    }
    order.items.forEach((item, index) => {
      if (item.productOptions?.hasSizes === true && item.size === null) missing.push(`items.${index}.size`);
      if (item.productOptions?.hasColors === true && item.color === null) missing.push(`items.${index}.color`);
    });
  }
  if (to === "shipped" && order.delivery.company === null) {
    missing.push("delivery.company");
  }
  return missing;
}
