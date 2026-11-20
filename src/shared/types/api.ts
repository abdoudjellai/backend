import type { ErrorCode } from "../constants/error-codes.js";
import type { Store } from "../../modules/stores/store.model.js";

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

/** The authenticated business owner, set by the authenticate middleware. */
export interface AuthContext {
  ownerId: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    /** Set by the request-id middleware for every request. */
    requestId: string;
    /** Set by the authenticate middleware on private routes. */
    auth?: AuthContext;
    /** Set by the authorize-store middleware on /stores/:storeId routes, after ownership is verified. */
    store?: Store;
  }
}
