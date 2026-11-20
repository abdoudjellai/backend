import { z } from "zod";
import {
  channelSourceSchema,
  dateQuery,
  idSchema,
  optionalText,
  paginationQuerySchema,
  phoneSchema,
} from "../../shared/validation/common.js";
import { INITIAL_STATUSES, ORDER_STATUSES } from "./order-status.js";

export const MAX_ITEM_QUANTITY = 100;
export const MAX_ORDER_ITEMS = 50;

/**
 * Only product, options and quantity are accepted. Any unitPrice, productName, lineTotal or
 * totalAmount in the request is stripped — prices always come from the catalog.
 */
const orderItemSchema = z.object({
  productId: idSchema,
  size: z.union([z.number().positive().max(1000), z.string().trim().min(1).max(20)]).nullable().optional(),
  color: z.string().trim().min(1).max(40).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
});

const itemsSchema = z.array(orderItemSchema).min(1, "an order needs at least one item").max(MAX_ORDER_ITEMS);

const addressFields = {
  wilaya: optionalText(60),
  address: optionalText(500),
  phone: phoneSchema.nullable(),
};

export const createOrderSchema = z.object({
  customerId: idSchema,
  items: itemsSchema,
  /** Fields left out are copied from the customer record. Courier/tracking cannot be set at creation. */
  delivery: z.object(addressFields).partial().default({}),
  status: z.enum(INITIAL_STATUSES).default("pending_confirmation"),
  source: channelSourceSchema.default("manual"),
  notes: optionalText(1000).default(null),
});

export const updateOrderSchema = z
  .object({
    customerId: idSchema,
    items: itemsSchema,
    delivery: z
      .object({
        ...addressFields,
        company: optionalText(100),
        trackingNumber: optionalText(100),
      })
      .partial()
      .refine((value) => Object.keys(value).length > 0, "at least one delivery field is required"),
    notes: optionalText(1000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: optionalText(500).default(null),
});

export const listOrdersQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(ORDER_STATUSES).optional(),
    customerId: idSchema.optional(),
    /** Created on/after this date or datetime (date-only values are UTC). */
    from: dateQuery("start").optional(),
    /** Created on/before this date (whole day, UTC) or datetime. */
    to: dateQuery("end").optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "from must be before to",
    path: ["from"],
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
