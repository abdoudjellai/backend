import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { storesRouter } from "../modules/stores/stores.routes.js";

/**
 * Versioned API router, mounted at /api/v1.
 * - /auth: public login (rate limited) and /auth/me (authenticated)
 * - /stores: everything else — authenticated; /stores/:storeId/* also checks store ownership
 */
export function createApiRouter(): Router {
  const router = Router();
  router.use("/auth", createAuthRouter());
  router.use("/stores", authenticate, storesRouter);
  return router;
}
