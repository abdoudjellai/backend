import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { api, createStore, login, type Api } from "../helpers.js";

const app = createApp();
let client: Api;
let storeId: string;
let otherStoreId: string;

beforeAll(async () => {
  await storage.open();
  client = api(app, await login(app));
  storeId = await createStore(client);
  otherStoreId = await createStore(client);
});

afterAll(async () => {
  await storage.close();
});

const url = (id = storeId) => `/api/v1/stores/${id}/products`;
const blackShoes = {
  name: "Black Shoes",
  description: "Black casual shoes",
  price: 4500,
  stock: 20,
  sizes: [40, 41, 42, 43],
  colors: ["Black", "White"],
};

describe("products CRUD", () => {
  it("creates a product", async () => {
    const res = await client.post(url(), { ...blackShoes, storeId: otherStoreId });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ ...blackShoes, id: expect.stringMatching(/^product_/), storeId });
  });

  it("applies defaults for optional fields", async () => {
    const res = await client.post(url(), { name: "Gift card", price: 1000 });
    expect(res.body.data).toMatchObject({ description: null, stock: 0, sizes: [], colors: [] });
  });

  it.each([
    ["negative price", { price: -1 }, "price"],
    ["fractional price", { price: 4500.5 }, "price"],
    ["huge price", { price: 1e12 }, "price"],
    ["negative stock", { stock: -5 }, "stock"],
    ["fractional stock", { stock: 1.5 }, "stock"],
    ["duplicate sizes", { sizes: [42, 42] }, "sizes"],
    ["duplicate colors", { colors: ["Black", "black"] }, "colors"],
    ["empty name", { name: "  " }, "name"],
    ["price as string", { price: "4500" }, "price"],
  ])("rejects %s", async (_label, override, path) => {
    const res = await client.post(url(), { ...blackShoes, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it("supports label sizes like M or XL", async () => {
    const res = await client.post(url(), { name: "T-Shirt", price: 1800, sizes: ["S", "M", "XL"] });
    expect(res.status).toBe(201);
    expect(res.body.data.sizes).toEqual(["S", "M", "XL"]);
  });

  it("gets, searches, filters, updates and deletes", async () => {
    const created = (await client.post(url(), { ...blackShoes, name: "Searchable Boots", stock: 0 })).body.data;

    expect((await client.get(`${url()}/${created.id}`)).body.data.name).toBe("Searchable Boots");
    expect((await client.get(`${url()}?q=searchable`)).body.data.items.map((p: { id: string }) => p.id)).toEqual([created.id]);
    const outOfStock = (await client.get(`${url()}?inStock=false`)).body.data.items;
    expect(outOfStock.every((p: { stock: number }) => p.stock === 0)).toBe(true);

    const updated = await client.patch(`${url()}/${created.id}`, { price: 5000, stock: 3 });
    expect(updated.body.data).toMatchObject({ price: 5000, stock: 3, name: "Searchable Boots" });
    expect((await client.patch(`${url()}/${created.id}`, { price: -1 })).status).toBe(400);

    expect((await client.delete(`${url()}/${created.id}`)).body.data).toEqual({ id: created.id, deleted: true });
    expect((await client.get(`${url()}/${created.id}`)).status).toBe(404);
  });

  it("cannot access another store's product", async () => {
    const foreign = (await client.post(url(otherStoreId), blackShoes)).body.data;
    expect((await client.get(`${url()}/${foreign.id}`)).status).toBe(404);
    expect((await client.patch(`${url()}/${foreign.id}`, { price: 1 })).status).toBe(404);
    expect((await client.delete(`${url()}/${foreign.id}`)).status).toBe(404);
    expect(storage.products.findById(foreign.id)?.price).toBe(4500);
  });
});
