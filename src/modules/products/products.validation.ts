import { z } from "zod";
import { optionalText, paginationQuerySchema } from "../../shared/validation/common.js";

export const MAX_PRICE_DZD = 10_000_000;
export const MAX_STOCK = 1_000_000;

const sizeSchema = z.union([z.number().positive().max(1000), z.string().trim().min(1).max(20)]);

const sizesSchema = z
  .array(sizeSchema)
  .max(50)
  .refine((sizes) => new Set(sizes.map(String)).size === sizes.length, "sizes must be unique");

const colorsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(50)
  .refine((colors) => new Set(colors.map((c) => c.toLowerCase())).size === colors.length, "colors must be unique");

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  price: z.number().int("must be a whole number of dinars (DZD)").min(0).max(MAX_PRICE_DZD),
  stock: z.number().int().min(0).max(MAX_STOCK),
  sizes: sizesSchema,
  colors: colorsSchema,
};

export const createProductSchema = z.object({
  ...productFields,
  description: productFields.description.default(null),
  stock: productFields.stock.default(0),
  sizes: productFields.sizes.default([]),
  colors: productFields.colors.default([]),
});

export const updateProductSchema = z
  .object(productFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const listProductsQuerySchema = paginationQuerySchema.extend({
  /** Case-insensitive search in name and description. */
  q: z.string().trim().min(1).max(100).optional(),
  /** "true" → only stock > 0, "false" → only stock = 0. */
  inStock: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
