import type { Request } from "express";
import type { Store } from "../../modules/stores/store.model.js";
import { AppError } from "../errors/app-error.js";
import type { AuthContext } from "../types/api.js";

/** The authenticated owner. Throws if the route forgot the authenticate middleware. */
export function getAuth(req: Request): AuthContext {
  if (req.auth === undefined) throw AppError.unauthorized();
  return req.auth;
}

/** The ownership-verified store. Throws if the route forgot the authorize-store middleware. */
export function getStore(req: Request): Store {
  if (req.store === undefined) throw new Error("authorize-store middleware is missing on this route");
  return req.store;
}
