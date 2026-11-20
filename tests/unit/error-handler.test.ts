import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAppError } from "../../src/middleware/error-handler.js";
import { AppError } from "../../src/shared/errors/app-error.js";

describe("toAppError", () => {
  it("passes AppError through unchanged", () => {
    const original = AppError.notFound("Order not found");
    expect(toAppError(original)).toBe(original);
  });

  it("maps ZodError to a 400 VALIDATION_ERROR with field details", () => {
    const result = z.object({ quantity: z.number().int().positive() }).safeParse({ quantity: -1 });
    expect(result.success).toBe(false);
    const appError = toAppError(result.error);
    expect(appError.statusCode).toBe(400);
    expect(appError.code).toBe("VALIDATION_ERROR");
    expect(appError.details).toEqual([expect.objectContaining({ path: "quantity" })]);
  });

  it("maps body-parser errors to client errors", () => {
    expect(toAppError({ type: "entity.parse.failed", status: 400 }).statusCode).toBe(400);
    expect(toAppError({ type: "entity.too.large", status: 413 }).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("hides the message of unexpected errors", () => {
    const appError = toAppError(new Error("E11000 duplicate key error collection: secrets.users"));
    expect(appError.statusCode).toBe(500);
    expect(appError.code).toBe("INTERNAL_ERROR");
    expect(appError.message).toBe("Internal server error");
  });
});
