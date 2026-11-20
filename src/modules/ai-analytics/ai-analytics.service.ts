import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { byCreatedAtDesc, paginate, type Page } from "../../shared/utils/pagination.js";
import type { AiAnalysis } from "./ai-analysis.model.js";
import type { CreateAiAnalysisInput, ListAiAnalysesQuery } from "./ai-analytics.validation.js";

function orderExistsInStore(storeId: string, orderId: string): boolean {
  return storage.orders.findOne((order) => order.id === orderId && order.storeId === storeId) !== undefined;
}

/** Persist a new analysis. Earlier analyses of the same order are kept as history. */
export async function createAiAnalysis(storeId: string, input: CreateAiAnalysisInput): Promise<AiAnalysis> {
  if (!orderExistsInStore(storeId, input.orderId)) {
    throw AppError.invalidReference("Order not found in this store", { field: "orderId", orderId: input.orderId });
  }
  return storage.aiAnalytics.create({ ...input, storeId });
}

export function listAiAnalyses(storeId: string, query: ListAiAnalysesQuery): Page<AiAnalysis> {
  const analyses = storage.aiAnalytics
    .findAll(
      (analysis) =>
        analysis.storeId === storeId &&
        (query.orderId === undefined || analysis.orderId === query.orderId) &&
        (query.riskLevel === undefined || analysis.riskLevel === query.riskLevel),
    )
    .sort(byCreatedAtDesc);
  return paginate(analyses, query.page, query.limit);
}

export interface OrderAnalyses {
  orderId: string;
  /** The most recent analysis, or null when the order has not been analyzed. */
  latest: AiAnalysis | null;
  /** All analyses of the order, newest first. */
  history: AiAnalysis[];
}

export function getOrderAnalyses(storeId: string, orderId: string): OrderAnalyses {
  if (!orderExistsInStore(storeId, orderId)) throw AppError.notFound("Order not found");
  const history = storage.aiAnalytics
    .findAll((analysis) => analysis.storeId === storeId && analysis.orderId === orderId)
    .sort(byCreatedAtDesc);
  return { orderId, latest: history[0] ?? null, history };
}
