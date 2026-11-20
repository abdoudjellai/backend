import { z } from "zod";
import {
  channelSourceSchema,
  optionalText,
  paginationQuerySchema,
  phoneSchema,
} from "../../shared/validation/common.js";

const platformCustomerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "may contain only letters, digits and . _ : -");

const customerFields = {
  name: optionalText(120),
  phone: phoneSchema.nullable(),
  wilaya: optionalText(60),
  address: optionalText(500),
  platformCustomerId: platformCustomerIdSchema.nullable(),
};

export const createCustomerSchema = z.object({
  name: customerFields.name.default(null),
  phone: customerFields.phone.default(null),
  wilaya: customerFields.wilaya.default(null),
  address: customerFields.address.default(null),
  source: channelSourceSchema.default("manual"),
  platformCustomerId: customerFields.platformCustomerId.default(null),
});

export const updateCustomerSchema = z
  .object({ ...customerFields, source: channelSourceSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  /** Exact match after normalization — lets n8n find a returning customer by phone. */
  phone: phoneSchema.optional(),
  /** Exact match — lets n8n find a returning customer by platform ID (combine with `source`). */
  platformCustomerId: platformCustomerIdSchema.optional(),
  source: channelSourceSchema.optional(),
  /** Case-insensitive search in name, phone, wilaya and address. */
  q: z.string().trim().min(1).max(100).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
