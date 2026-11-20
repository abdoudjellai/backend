import { z } from "zod";
import { idSchema, optionalText, paginationQuerySchema } from "../../shared/validation/common.js";
import { RISK_LEVELS } from "./ai-analysis.model.js";

/**
 * An analysis result from n8n. The storeId is never read from the body — it comes from the
 * ownership-verified URL — and the order must belong to that store.
 */
export const createAiAnalysisSchema = z.object({
  orderId: idSchema,
  returnRisk: z.number().min(0, "must be between 0 and 1").max(1, "must be between 0 and 1"),
  riskLevel: z.enum(RISK_LEVELS),
  recommendedCourier: optionalText(100).default(null),
  recommendations: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export const listAiAnalysesQuerySchema = paginationQuerySchema.extend({
  orderId: idSchema.optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
});

export type CreateAiAnalysisInput = z.infer<typeof createAiAnalysisSchema>;
export type ListAiAnalysesQuery = z.infer<typeof listAiAnalysesQuerySchema>;
