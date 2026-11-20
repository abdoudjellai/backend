import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { byCreatedAtDesc, paginate, type Page } from "../../shared/utils/pagination.js";
import type { Product } from "./product.model.js";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "./products.validation.js";

export function listProducts(storeId: string, query: ListProductsQuery): Page<Product> {
  const q = query.q?.toLowerCase();
  const products = storage.products
    .findAll(
      (product) =>
        product.storeId === storeId &&
        (query.inStock === undefined || product.stock > 0 === query.inStock) &&
        (q === undefined ||
          product.name.toLowerCase().includes(q) ||
          (product.description?.toLowerCase().includes(q) ?? false)),
    )
    .sort(byCreatedAtDesc);
  return paginate(products, query.page, query.limit);
}

export function getProduct(storeId: string, productId: string): Product {
  const product = storage.products.findOne((p) => p.id === productId && p.storeId === storeId);
  if (product === undefined) throw AppError.notFound("Product not found");
  return product;
}

export async function createProduct(storeId: string, input: CreateProductInput): Promise<Product> {
  return storage.products.create({ ...input, storeId });
}

export async function updateProduct(storeId: string, productId: string, input: UpdateProductInput): Promise<Product> {
  getProduct(storeId, productId);
  const updated = await storage.products.update(productId, input);
  if (updated === undefined) throw AppError.notFound("Product not found");
  return updated;
}

/** Existing orders are unaffected: they keep a snapshot of the product name and price. */
export async function deleteProduct(storeId: string, productId: string): Promise<void> {
  getProduct(storeId, productId);
  await storage.products.delete(productId);
}
