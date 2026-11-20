import { Router } from "express";
import { getAiAnalyses, getAiAnalysesForOrder, postAiAnalysis } from "./ai-analytics.controller.js";

/** Mounted at /api/v1/stores/:storeId after authentication and store-ownership checks. */
export const aiAnalyticsRouter = Router();

aiAnalyticsRouter.post("/ai-analytics", postAiAnalysis);
aiAnalyticsRouter.get("/ai-analytics", getAiAnalyses);
aiAnalyticsRouter.get("/orders/:orderId/ai-analytics", getAiAnalysesForOrder);
