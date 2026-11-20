import { Router } from "express";
import { getAnalyticsAi, getAnalyticsOrders, getAnalyticsOverview } from "./analytics.controller.js";

/** Mounted at /api/v1/stores/:storeId/analytics after authentication and store-ownership checks. */
export const analyticsRouter = Router();

analyticsRouter.get("/overview", getAnalyticsOverview);
analyticsRouter.get("/orders", getAnalyticsOrders);
analyticsRouter.get("/ai", getAnalyticsAi);
