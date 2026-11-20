import type { ErrorCode } from "../constants/error-codes.js";

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

declare module "express-serve-static-core" {
  interface Request {
    /** Set by the request-id middleware for every request. */
    requestId: string;
  }
}
