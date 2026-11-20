import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { api, createCustomer, createProduct, createStore, login, type Api } from "../helpers.js";

const app = createApp();
let client: Api;
let foreignStoreId: string;

beforeAll(async () => {
  await storage.open();
  client = api(app, await login(app));
  // A store that belongs to a different owner (e.g. data from another account).
  const foreign = await storage.stores.create({ name: "Not mine", ownerId: "owner_other", description: null });
  foreignStoreId = foreign.id;
});

afterAll(async () => {
  await storage.close();
});

describe("stores CRUD", () => {
  it("creates a store owned by the authenticated owner, ignoring a submitted ownerId", async () => {
    const res = await client.post("/api/v1/stores", { name: "  Demo Store ", description: "E-commerce business", ownerId: "owner_other" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: expect.stringMatching(/^store_/),
      name: "Demo Store",
      description: "E-commerce business",
      ownerId: "owner_test",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("validates input", async () => {
    const res = await client.post("/api/v1/stores", { name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("name");
  });

  it("lists only the owner's stores, paginated", async () => {
    const res = await client.get("/api/v1/stores?limit=100");
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(foreignStoreId);
    expect(res.body.data.items.every((s: { ownerId: string }) => s.ownerId === "owner_test")).toBe(true);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100 });
  });

  it("rejects page sizes above the maximum", async () => {
    expect((await client.get("/api/v1/stores?limit=500")).status).toBe(400);
  });

  it("gets, updates and deletes an empty store", async () => {
    const storeId = await createStore(client, "Temp");
    expect((await client.get(`/api/v1/stores/${storeId}`)).body.data.name).toBe("Temp");

    const updated = await client.patch(`/api/v1/stores/${storeId}`, { name: "Renamed", description: null });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: "Renamed", description: null, ownerId: "owner_test" });

    expect((await client.patch(`/api/v1/stores/${storeId}`, {})).status).toBe(400);

    const deleted = await client.delete(`/api/v1/stores/${storeId}`);
    expect(deleted.body.data).toEqual({ id: storeId, deleted: true });
    expect((await client.get(`/api/v1/stores/${storeId}`)).status).toBe(404);
  });

  it("refuses to delete a store that still has data", async () => {
    const storeId = await createStore(client);
    await createProduct(client, storeId);
    await createCustomer(client, storeId);
    const res = await client.delete(`/api/v1/stores/${storeId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(res.body.error.details.counts).toMatchObject({ customers: 1, products: 1 });
  });
});

describe("store ownership", () => {
  it("returns 404 for another owner's store on every route", async () => {
    const base = `/api/v1/stores/${foreignStoreId}`;
    const attempts = [
      client.get(base),
      client.patch(base, { name: "Hijacked" }),
      client.delete(base),
      client.get(`${base}/customers`),
      client.post(`${base}/customers`, { name: "x" }),
      client.get(`${base}/products`),
      client.post(`${base}/products`, { name: "x", price: 1 }),
      client.get(`${base}/orders`),
      client.get(`${base}/ai-analytics`),
      client.get(`${base}/analytics/overview`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Store not found" });
    }
    expect(storage.stores.findById(foreignStoreId)?.name).toBe("Not mine");
    expect(storage.customers.count((c) => c.storeId === foreignStoreId)).toBe(0);
  });

  it("returns 404 for a store that does not exist and 400 for a malformed id", async () => {
    expect((await client.get("/api/v1/stores/store_doesnotexist")).status).toBe(404);
    const res = await client.get("/api/v1/stores/..%2F..%2Fetc");
    expect(res.status).toBe(400);
  });
});
