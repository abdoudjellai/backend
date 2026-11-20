import type { BaseRecord } from "../../storage/json-collection.js";

/** Shoe sizes are numbers (42); clothing sizes are labels ("M", "XL"). */
export type ProductSize = number | string;

export interface Product extends BaseRecord {
  storeId: string;
  name: string;
  description: string | null;
  /** Unit price in whole Algerian dinars (DZD). */
  price: number;
  /** Units available. Not deducted automatically by orders in this milestone. */
  stock: number;
  /** Allowed sizes; empty means the product has no size option. */
  sizes: ProductSize[];
  /** Allowed colors; empty means the product has no color option. */
  colors: string[];
}

export const CURRENCY = "DZD";
