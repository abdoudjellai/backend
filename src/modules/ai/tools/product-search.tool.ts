import { storage } from "../../../storage/index.js";
import type { Product } from "../../products/product.model.js";

export interface ProductSearchInput {
  storeId: string;
  query: string;
  size?: string | number;
  color?: string;
}

export interface ProductSearchResult {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: "DZD";
  stock: number;
  sizes: (string | number)[];
  colors: string[];
  inStock: boolean;
}

const MAX_RESULTS = 10;

export function searchProducts(input: ProductSearchInput): ProductSearchResult[] {
  const q = input.query.toLowerCase();

  const matches = storage.products.findAll((product: Readonly<Product>) => {
    if (product.storeId !== input.storeId) return false;
    const nameMatch = product.name.toLowerCase().includes(q);
    const descMatch = product.description?.toLowerCase().includes(q) ?? false;
    if (!nameMatch && !descMatch) return false;
    if (input.size !== undefined) {
      const sizeStr = String(input.size).toLowerCase();
      if (!product.sizes.some((s) => String(s).toLowerCase() === sizeStr)) return false;
    }
    if (input.color !== undefined) {
      const colorStr = input.color.toLowerCase();
      if (!product.colors.some((c) => c.toLowerCase() === colorStr)) return false;
    }
    return true;
  });

  return matches.slice(0, MAX_RESULTS).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: "DZD",
    stock: product.stock,
    sizes: product.sizes,
    colors: product.colors,
    inStock: product.stock > 0,
  }));
}

export const PRODUCT_SEARCH_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "search_products",
    description: "Search the store's product catalog by name or description. Returns real prices, stock, sizes and colors.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (product name or keyword)" },
        size: { type: "string", description: "Filter by size (optional)" },
        color: { type: "string", description: "Filter by color (optional)" },
      },
      required: ["query"],
    },
  },
};
