import { join, resolve } from "node:path";
import type { AiAnalysis } from "../modules/ai-analytics/ai-analysis.model.js";
import type { Customer } from "../modules/customers/customer.model.js";
import type { Order } from "../modules/orders/order.model.js";
import type { Product } from "../modules/products/product.model.js";
import type { Store } from "../modules/stores/store.model.js";
import { JsonCollection } from "./json-collection.js";

/**
 * All storage collections. File names are fixed here in code — never derived from user
 * input — so requests cannot read or write arbitrary paths.
 */
export class Storage {
  readonly directory: string;
  readonly stores: JsonCollection<Store>;
  readonly customers: JsonCollection<Customer>;
  readonly products: JsonCollection<Product>;
  readonly orders: JsonCollection<Order>;
  readonly aiAnalytics: JsonCollection<AiAnalysis>;
  private opened = false;

  constructor(directory: string) {
    this.directory = resolve(directory);
    const file = (name: string): string => join(this.directory, `${name}.json`);
    this.stores = new JsonCollection<Store>("stores", file("stores"), "store");
    this.customers = new JsonCollection<Customer>("customers", file("customers"), "customer");
    this.products = new JsonCollection<Product>("products", file("products"), "product");
    this.orders = new JsonCollection<Order>("orders", file("orders"), "order");
    this.aiAnalytics = new JsonCollection<AiAnalysis>("ai-analytics", file("ai-analytics"), "analysis");
  }

  private all() {
    return [this.stores, this.customers, this.products, this.orders, this.aiAnalytics];
  }

  /** Load every collection, creating missing files as empty arrays. */
  async open(): Promise<void> {
    for (const collection of this.all()) {
      await collection.load();
    }
    this.opened = true;
  }

  /** Wait for all pending writes, then stop reporting healthy. */
  async close(): Promise<void> {
    await Promise.all(this.all().map((collection) => collection.flush()));
    this.opened = false;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.opened) return false;
    const results = await Promise.all(this.all().map((collection) => collection.isHealthy()));
    return results.every(Boolean);
  }

  counts(): Record<string, number> {
    return Object.fromEntries(this.all().map((collection) => [collection.name, collection.count()]));
  }
}
