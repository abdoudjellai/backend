import { ErrorCodes, type ErrorCode } from "../constants/error-codes.js";

/**
 * An expected, client-safe error. Its `message` and `details` are returned to the caller,
 * so they must never contain secrets, stack traces, file paths or raw storage errors.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message = "Bad request", details?: unknown): AppError {
    return new AppError(400, ErrorCodes.BAD_REQUEST, message, details);
  }

  static unauthorized(message = "Authentication required"): AppError {
    return new AppError(401, ErrorCodes.UNAUTHORIZED, message);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError(404, ErrorCodes.NOT_FOUND, message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, ErrorCodes.CONFLICT, message, details);
  }

  static invalidReference(message: string, details?: unknown): AppError {
    return new AppError(422, ErrorCodes.INVALID_REFERENCE, message, details);
  }

  static businessRule(message: string, details?: unknown): AppError {
    return new AppError(409, ErrorCodes.BUSINESS_RULE_VIOLATION, message, details);
  }

  static serviceUnavailable(message = "Service unavailable", details?: unknown): AppError {
    return new AppError(503, ErrorCodes.SERVICE_UNAVAILABLE, message, details);
  }
}
