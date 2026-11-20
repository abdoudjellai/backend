import { Router } from "express";
import { authorizeStore } from "../../middleware/authorize-store.js";
import { aiAnalyticsRouter } from "../ai-analytics/ai-analytics.routes.js";
import { analyticsRouter } from "../analytics/analytics.routes.js";
import { customersRouter } from "../customers/customers.routes.js";
import { ordersRouter } from "../orders/orders.routes.js";
import { productsRouter } from "../products/products.routes.js";
import { getStoreById, getStores, patchStore, postStore, removeStore } from "./stores.controller.js";

/** Mounted at /api/v1/stores behind the authenticate middleware. */
export const storesRouter = Router();

storesRouter.post("/", postStore);
storesRouter.get("/", getStores);

/** Everything under /stores/:storeId — reached only after the ownership check. */
const storeRouter = Router();
storeRouter.get("/", getStoreById);
storeRouter.patch("/", patchStore);
storeRouter.delete("/", removeStore);
storeRouter.use("/customers", customersRouter);
storeRouter.use("/products", productsRouter);
storeRouter.use("/orders", ordersRouter);
storeRouter.use("/analytics", analyticsRouter);
// Registers /ai-analytics and /orders/:orderId/ai-analytics.
storeRouter.use("/", aiAnalyticsRouter);

storesRouter.use("/:storeId", authorizeStore, storeRouter);
