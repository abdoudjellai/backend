import { ErrorCodes } from "../../shared/constants/error-codes.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { Product, ProductSize } from "../products/product.model.js";
import type { OrderItem } from "./order.model.js";

export interface OrderItemInput {
  productId: string;
  size?: ProductSize | null | undefined;
  color?: string | null | undefined;
  quantity: number;
}

export interface PricedOrder {
  items: OrderItem[];
  totalAmount: number;
}

/** Returns the product's own spelling of a size, or undefined if the product does not offer it. */
function matchSize(product: Product, size: ProductSize): ProductSize | undefined {
  return product.sizes.find((candidate) => String(candidate).toLowerCase() === String(size).toLowerCase());
}

function matchColor(product: Product, color: string): string | undefined {
  return product.colors.find((candidate) => candidate.toLowerCase() === color.toLowerCase());
}

/**
 * Build order lines from trusted catalog data.
 *
 * `findProduct` must only return products of the order's store, so a product from another store
 * is reported as not found. Prices and names come from the catalog; any price, name or total sent
 * by the client is never read. Throws:
 * - 422 INVALID_REFERENCE when a product does not exist in the store
 * - 400 VALIDATION_ERROR when a size/color is not offered by the product
 * - 409 INSUFFICIENT_STOCK when the requested quantity (summed per product) exceeds stock
 */
export function priceOrderItems(
  inputs: readonly OrderItemInput[],
  findProduct: (productId: string) => Product | undefined,
): PricedOrder {
  const optionErrors: { path: string; message: string }[] = [];
  const requestedByProduct = new Map<string, { product: Product; quantity: number }>();

  const items = inputs.map((input, index): OrderItem => {
    const product = findProduct(input.productId);
    if (product === undefined) {
      throw AppError.invalidReference("Product not found in this store", {
        field: `items.${index}.productId`,
        productId: input.productId,
      });
    }

    let size: ProductSize | null = null;
    if (input.size !== undefined && input.size !== null) {
      const matched = matchSize(product, input.size);
      if (matched === undefined) {
        optionErrors.push({
          path: `items.${index}.size`,
          message:
            product.sizes.length === 0
              ? "this product has no size option"
              : `must be one of: ${product.sizes.join(", ")}`,
        });
      } else {
        size = matched;
      }
    }

    let color: string | null = null;
    if (input.color !== undefined && input.color !== null) {
      const matched = matchColor(product, input.color);
      if (matched === undefined) {
        optionErrors.push({
          path: `items.${index}.color`,
          message:
            product.colors.length === 0
              ? "this product has no color option"
              : `must be one of: ${product.colors.join(", ")}`,
        });
      } else {
        color = matched;
      }
    }

    const requested = requestedByProduct.get(product.id);
    requestedByProduct.set(product.id, { product, quantity: (requested?.quantity ?? 0) + input.quantity });

    return {
      productId: product.id,
      productName: product.name,
      size,
      color,
      quantity: input.quantity,
      unitPrice: product.price,
      lineTotal: product.price * input.quantity,
    };
  });

  if (optionErrors.length > 0) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, "Invalid product options", optionErrors);
  }

  assertStockAvailable([...requestedByProduct.values()]);

  return { items, totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0) };
}

/** Availability check only — stock is never deducted in this milestone. */
export function assertStockAvailable(requests: readonly { product: Product; quantity: number }[]): void {
  const shortages = requests
    .filter(({ product, quantity }) => quantity > product.stock)
    .map(({ product, quantity }) => ({ productId: product.id, productName: product.name, requested: quantity, available: product.stock }));
  if (shortages.length > 0) {
    throw new AppError(409, ErrorCodes.INSUFFICIENT_STOCK, "Not enough stock for one or more products", shortages);
  }
}
