/** Stable, machine-readable error codes returned in the error envelope. */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  /** A referenced record (customer, product, order) does not exist in this store. */
  INVALID_REFERENCE: "INVALID_REFERENCE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  /** The record exists but its current state does not allow this operation. */
  BUSINESS_RULE_VIOLATION: "BUSINESS_RULE_VIOLATION",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
