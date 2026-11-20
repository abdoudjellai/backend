import { z } from "zod";
import { optionalText, paginationQuerySchema } from "../../shared/validation/common.js";

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000).default(null),
});

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: optionalText(1000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const listStoresQuerySchema = paginationQuerySchema;

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
