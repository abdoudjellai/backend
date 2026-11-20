import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { api, createProduct, createStore, login, type Api } from "../helpers.js";

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

const url = (id = storeId) => `/api/v1/stores/${id}/customers`;

describe("customers CRUD", () => {
  it("creates a customer with a normalized phone, ignoring a submitted storeId", async () => {
    const res = await client.post(url(), {
      name: "Customer Name",
      phone: "+213 550 00 00 01",
      wilaya: "Blida",
      address: "Blida Centre",
      source: "messenger",
      platformCustomerId: "MESSENGER_PSID_1",
      storeId: otherStoreId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: expect.stringMatching(/^customer_/),
      storeId,
      name: "Customer Name",
      phone: "0550000001",
      source: "messenger",
      platformCustomerId: "MESSENGER_PSID_1",
    });
  });

  it("allows a customer with only a platform ID (e.g. new Messenger contact)", async () => {
    const res = await client.post(url(), { source: "messenger", platformCustomerId: "PSID_ONLY" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: null, phone: null, wilaya: null, source: "messenger" });
  });

  it("validates fields", async () => {
    const res = await client.post(url(), { phone: "12345", source: "fax" });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["phone", "source"]));
  });

  it("gets, lists, updates and deletes", async () => {
    const created = (await client.post(url(), { name: "Sara", phone: "0661234500", wilaya: "Alger" })).body.data;

    expect((await client.get(`${url()}/${created.id}`)).body.data.name).toBe("Sara");

    const list = await client.get(`${url()}?q=sara`);
    expect(list.body.data.items.map((c: { id: string }) => c.id)).toEqual([created.id]);

    const updated = await client.patch(`${url()}/${created.id}`, { wilaya: "Oran", address: "Es Senia" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ wilaya: "Oran", address: "Es Senia", phone: "0661234500" });

    expect((await client.delete(`${url()}/${created.id}`)).body.data).toEqual({ id: created.id, deleted: true });
    expect((await client.get(`${url()}/${created.id}`)).status).toBe(404);
  });
});

describe("customer duplicates", () => {
  it("rejects a duplicate phone in the same store and returns the existing id", async () => {
    const first = (await client.post(url(), { name: "Amine", phone: "0550111222" })).body.data;
    const res = await client.post(url(), { name: "Different name", phone: "+213550111222" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.details).toEqual({ field: "phone", existingCustomerId: first.id });
  });

  it("rejects a duplicate platform ID for the same source", async () => {
    const first = (await client.post(url(), { source: "messenger", platformCustomerId: "PSID_DUP" })).body.data;
    const res = await client.post(url(), { source: "messenger", platformCustomerId: "PSID_DUP" });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: "platformCustomerId", existingCustomerId: first.id });
    // Same ID on another platform is a different identity.
    expect((await client.post(url(), { source: "instagram", platformCustomerId: "PSID_DUP" })).status).toBe(201);
  });

  it("does not merge customers by name", async () => {
    expect((await client.post(url(), { name: "Mohamed" })).status).toBe(201);
    expect((await client.post(url(), { name: "Mohamed" })).status).toBe(201);
  });

  it("allows the same phone in a different store", async () => {
    await client.post(url(), { phone: "0550333444" });
    expect((await client.post(url(otherStoreId), { phone: "0550333444" })).status).toBe(201);
  });

  it("rejects an update that would create a duplicate", async () => {
    await client.post(url(), { phone: "0550555666" });
    const other = (await client.post(url(), { phone: "0550555777" })).body.data;
    const res = await client.patch(`${url()}/${other.id}`, { phone: "0550555666" });
    expect(res.status).toBe(409);
    // Re-saving its own phone is not a conflict.
    expect((await client.patch(`${url()}/${other.id}`, { phone: "0550555777" })).status).toBe(200);
  });

  it("finds a returning customer by phone or platform ID", async () => {
    const created = (await client.post(url(), { phone: "0770999888", source: "messenger", platformCustomerId: "PSID_RETURN" })).body.data;
    const byPhone = await client.get(`${url()}?phone=${encodeURIComponent("+213 770 99 98 88")}`);
    expect(byPhone.body.data.items.map((c: { id: string }) => c.id)).toEqual([created.id]);
    const byPlatform = await client.get(`${url()}?source=messenger&platformCustomerId=PSID_RETURN`);
    expect(byPlatform.body.data.items.map((c: { id: string }) => c.id)).toEqual([created.id]);
  });
});

describe("customer scoping", () => {
  it("cannot read, update or delete another store's customer", async () => {
    const foreign = (await client.post(url(otherStoreId), { name: "Other store customer" })).body.data;
    expect((await client.get(`${url()}/${foreign.id}`)).status).toBe(404);
    expect((await client.patch(`${url()}/${foreign.id}`, { name: "x" })).status).toBe(404);
    expect((await client.delete(`${url()}/${foreign.id}`)).status).toBe(404);
    expect(storage.customers.findById(foreign.id)?.name).toBe("Other store customer");
  });

  it("refuses to delete a customer who has orders", async () => {
    const product = await createProduct(client, storeId);
    const customer = (await client.post(url(), { name: "Has orders" })).body.data;
    await client.post(`/api/v1/stores/${storeId}/orders`, { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] });
    const res = await client.delete(`${url()}/${customer.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ orderCount: 1 });
  });
});
