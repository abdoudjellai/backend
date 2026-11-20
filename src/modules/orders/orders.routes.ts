import { Router } from "express";
import { getOrderById, getOrders, patchOrder, patchOrderStatus, postOrder } from "./orders.controller.js";

/**
 * Mounted at /api/v1/stores/:storeId/orders after authentication and store-ownership checks.
 * There is intentionally no DELETE: orders are business history; use status "cancelled".
 */
export const ordersRouter = Router();

ordersRouter.post("/", postOrder);
ordersRouter.get("/", getOrders);
ordersRouter.get("/:orderId", getOrderById);
ordersRouter.patch("/:orderId", patchOrder);
ordersRouter.patch("/:orderId/status", patchOrderStatus);
