import { describe, expect, it } from "vitest";
import type { Product } from "../../src/modules/products/product.model.js";
import { priceOrderItems } from "../../src/modules/orders/order-pricing.js";
import { AppError } from "../../src/shared/errors/app-error.js";

const product = (overrides: Partial<Product>): Product => ({
  id: "product_1",
  storeId: "store_1",
  name: "Black Shoes",
  description: null,
  price: 4500,
  stock: 20,
  sizes: [40, 41, 42],
  colors: ["Black", "White"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const catalog = new Map<string, Product>([
  ["product_1", product({})],
  ["product_2", product({ id: "product_2", name: "Boots", price: 7900, stock: 3, sizes: ["M", "L"], colors: [] })],
]);
const find = (id: string) => catalog.get(id);

function expectAppError(fn: () => unknown, statusCode: number, code: string): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(statusCode);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error("expected an AppError");
}

describe("priceOrderItems", () => {
  it("takes prices and names from the catalog and calculates totals", () => {
    const result = priceOrderItems(
      [
        { productId: "product_1", size: 42, color: "black", quantity: 2 },
        { productId: "product_2", size: "m", quantity: 1 },
      ],
      find,
    );
    expect(result.items).toEqual([
      { productId: "product_1", productName: "Black Shoes", size: 42, color: "Black", quantity: 2, unitPrice: 4500, lineTotal: 9000 },
      { productId: "product_2", productName: "Boots", size: "M", color: null, quantity: 1, unitPrice: 7900, lineTotal: 7900 },
    ]);
    expect(result.totalAmount).toBe(16_900);
  });

  it("ignores client-supplied prices and totals", () => {
    const tampered = { productId: "product_1", quantity: 1, unitPrice: 1, lineTotal: 1, productName: "Free" };
    const result = priceOrderItems([tampered], find);
    expect(result.items[0]).toMatchObject({ unitPrice: 4500, lineTotal: 4500, productName: "Black Shoes" });
    expect(result.totalAmount).toBe(4500);
  });

  it("rejects products that are not in the store", () => {
    const error = expectAppError(() => priceOrderItems([{ productId: "product_x", quantity: 1 }], find), 422, "INVALID_REFERENCE");
    expect(error.details).toMatchObject({ field: "items.0.productId" });
  });

  it("rejects sizes and colors the product does not offer", () => {
    const error = expectAppError(
      () =>
        priceOrderItems(
          [
            { productId: "product_1", size: 45, color: "Red", quantity: 1 },
            { productId: "product_2", color: "Black", quantity: 1 },
          ],
          find,
        ),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details).toEqual([
      { path: "items.0.size", message: "must be one of: 40, 41, 42" },
      { path: "items.0.color", message: "must be one of: Black, White" },
      { path: "items.1.color", message: "this product has no color option" },
    ]);
  });

  it("checks stock against the total quantity per product", () => {
    expect(() => priceOrderItems([{ productId: "product_2", quantity: 3 }], find)).not.toThrow();
    const error = expectAppError(
      () =>
        priceOrderItems(
          [
            { productId: "product_2", size: "M", quantity: 2 },
            { productId: "product_2", size: "L", quantity: 2 },
          ],
          find,
        ),
      409,
      "INSUFFICIENT_STOCK",
    );
    expect(error.details).toEqual([{ productId: "product_2", productName: "Boots", requested: 4, available: 3 }]);
  });
});
