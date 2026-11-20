import type { RequestHandler } from "express";
import { getOwnedStore } from "../modules/stores/stores.service.js";
import { idParams } from "../shared/validation/common.js";
import { getAuth } from "../shared/utils/request-context.js";

const paramsSchema = idParams("storeId");

/**
 * For every /stores/:storeId/... route: load the store and verify the authenticated owner owns it.
 * Stores that do not exist and stores owned by someone else both return 404, so the API never
 * reveals which store IDs exist. Downstream handlers read the verified store from `req.store`
 * and must never trust a storeId from the body or query.
 */
export const authorizeStore: RequestHandler = (req, _res, next) => {
  const { storeId } = paramsSchema.parse(req.params);
  req.store = getOwnedStore(getAuth(req).ownerId, storeId);
  next();
};
