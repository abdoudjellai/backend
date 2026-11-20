import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { ErrorCodes } from "../shared/constants/error-codes.js";
import { AppError } from "../shared/errors/app-error.js";
import type { ApiFailure } from "../shared/types/api.js";

/** Catch-all for unmatched routes. Mount after every router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
};

/** Shape of errors raised by body-parser (express.json). */
interface HttpParserError {
  type: string;
  status: number;
}

function isParserError(error: unknown): error is HttpParserError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { type?: unknown }).type === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

/** Convert any thrown value into a client-safe AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      "Invalid request",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  if (isParserError(error)) {
    switch (error.type) {
      case "entity.parse.failed":
        return new AppError(400, ErrorCodes.BAD_REQUEST, "Malformed JSON body");
      case "entity.too.large":
        return new AppError(413, ErrorCodes.PAYLOAD_TOO_LARGE, "Request body too large");
      case "encoding.unsupported":
      case "charset.unsupported":
        return new AppError(415, ErrorCodes.UNSUPPORTED_MEDIA_TYPE, "Unsupported request encoding");
      default:
        if (error.status >= 400 && error.status < 500) {
          return new AppError(error.status, ErrorCodes.BAD_REQUEST, "Bad request");
        }
    }
  }

  return new AppError(500, ErrorCodes.INTERNAL_ERROR, "Internal server error");
}

/**
 * Centralized error handler. Always responds with the standard error envelope and never
 * exposes stack traces or internal error messages to the caller.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = toAppError(error);
  const logContext = { requestId: req.requestId, code: appError.code, statusCode: appError.statusCode };

  if (appError.statusCode >= 500) {
    // Unexpected failure: log the original error (with stack) server-side only.
    logger.error({ ...logContext, err: error }, "Unhandled error");
  } else {
    logger.debug(logContext, appError.message);
  }

  const body: ApiFailure = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
    requestId: req.requestId,
  };
  res.status(appError.statusCode).json(body);
};
