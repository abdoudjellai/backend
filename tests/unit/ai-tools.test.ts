import { beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../src/storage/index.js";
import { searchProducts } from "../../src/modules/ai/tools/product-search.tool.js";
import { lookupCustomer } from "../../src/modules/ai/tools/customer-lookup.tool.js";
import { getOrderStatus } from "../../src/modules/ai/tools/order-status.tool.js";

const STORE_ID = "store_tools";

beforeAll(async () => {
  await storage.open();
  // Seed test data
  await storage.stores.create({ name: "Tool Test Store", ownerId: "owner_test", description: null });
  await storage.products.create({
    storeId: STORE_ID,
    name: "Black Running Shoes",
    description: "Comfortable running shoes",
    price: 4500,
    stock: 20,
    sizes: [40, 41, 42, 43],
    colors: ["Black", "White"],
  });
  await storage.products.create({
    storeId: STORE_ID,
    name: "White T-Shirt",
    description: "Plain cotton t-shirt",
    price: 1200,
    stock: 50,
    sizes: ["S", "M", "L", "XL"],
    colors: ["White", "Blue"],
  });
  await storage.products.create({
    storeId: STORE_ID,
    name: "Red Backpack",
    description: null,
    price: 3200,
    stock: 0,
    sizes: [],
    colors: ["Red", "Black"],
  });
  await storage.customers.create({
    storeId: STORE_ID,
    name: "Test Telegram User",
    phone: "0550123456",
    wilaya: "Alger",
    address: "123 Rue Test",
    source: "telegram",
    platformCustomerId: "tg_999",
  });
});

describe("searchProducts tool", () => {
  it("finds products by name", () => {
    const results = searchProducts({ storeId: STORE_ID, query: "shoes" });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Black Running Shoes");
    expect(results[0]!.price).toBe(4500);
    expect(results[0]!.currency).toBe("DZD");
    expect(results[0]!.inStock).toBe(true);
  });

  it("finds products by description", () => {
    const results = searchProducts({ storeId: STORE_ID, query: "cotton" });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("White T-Shirt");
  });

  it("filters by color", () => {
    const results = searchProducts({ storeId: STORE_ID, query: "backpack", color: "Red" });
    expect(results).toHaveLength(1);
    expect(results[0]!.inStock).toBe(false);
  });

  it("returns empty for no matches", () => {
    const results = searchProducts({ storeId: STORE_ID, query: "laptop" });
    expect(results).toEqual([]);
  });

  it("does not return products from other stores", () => {
    const results = searchProducts({ storeId: "other_store", query: "shoes" });
    expect(results).toEqual([]);
  });
});

describe("lookupCustomer tool", () => {
  it("finds a customer by telegram user ID", () => {
    const result = lookupCustomer({ storeId: STORE_ID, telegramUserId: "tg_999" });
    expect(result.found).toBe(true);
    expect(result.customer!.name).toBe("Test Telegram User");
    expect(result.customer!.phone).toBe("0550123456");
  });

  it("returns found:false for unknown telegram user", () => {
    const result = lookupCustomer({ storeId: STORE_ID, telegramUserId: "tg_unknown" });
    expect(result.found).toBe(false);
    expect(result.customer).toBeNull();
  });

  it("does not find customer from another store", () => {
    const result = lookupCustomer({ storeId: "other_store", telegramUserId: "tg_999" });
    expect(result.found).toBe(false);
  });
});

describe("getOrderStatus tool", () => {
  it("returns found:false when customer has no orders", () => {
    const result = getOrderStatus({ storeId: STORE_ID, telegramUserId: "tg_999" });
    expect(result.found).toBe(false);
    expect(result.orders).toEqual([]);
  });

  it("returns found:false for unknown customer", () => {
    const result = getOrderStatus({ storeId: STORE_ID, telegramUserId: "tg_unknown" });
    expect(result.found).toBe(false);
  });
});
