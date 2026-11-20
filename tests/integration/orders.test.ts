import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { api, createCustomer, createProduct, createStore, login, type Api } from "../helpers.js";

const app = createApp();
let client: Api;
let storeId: string;
let otherStoreId: string;
let shoes: { id: string; price: number };
let boots: { id: string; price: number };
let customer: { id: string };

beforeAll(async () => {
  await storage.open();
  client = api(app, await login(app));
  storeId = await createStore(client);
  otherStoreId = await createStore(client);
  shoes = await createProduct(client, storeId);
  boots = await createProduct(client, storeId, { name: "Boots", price: 7900, stock: 2, sizes: [41, 42], colors: ["Brown"] });
  customer = await createCustomer(client, storeId, { phone: "0550123456", wilaya: "Blida", address: "Blida Centre" });
});

afterAll(async () => {
  await storage.close();
});

const url = (id = storeId) => `/api/v1/stores/${id}/orders`;

async function newOrder(body: object = {}) {
  const res = await client.post(url(), {
    customerId: customer.id,
    items: [{ productId: shoes.id, size: 42, color: "Black", quantity: 1 }],
    ...body,
  });
  if (res.status !== 201) throw new Error(`order create failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

const setStatus = (orderId: string, status: string, note?: string) =>
  client.patch(`${url()}/${orderId}/status`, { status, ...(note !== undefined ? { note } : {}) });

describe("order creation", () => {
  it("creates an order with backend-calculated prices and catalog snapshots", async () => {
    const res = await client.post(url(), {
      customerId: customer.id,
      items: [
        { productId: shoes.id, size: 42, color: "black", quantity: 2, unitPrice: 1, productName: "Hacked" },
        { productId: boots.id, size: 41, color: "Brown", quantity: 1, unitPrice: 0 },
      ],
      totalAmount: 1,
      source: "messenger",
    });
    expect(res.status).toBe(201);
    const order = res.body.data;
    expect(order.items).toEqual([
      { productId: shoes.id, productName: "Black Shoes", size: 42, color: "Black", quantity: 2, unitPrice: 4500, lineTotal: 9000 },
      { productId: boots.id, productName: "Boots", size: 41, color: "Brown", quantity: 1, unitPrice: 7900, lineTotal: 7900 },
    ]);
    expect(order).toMatchObject({
      id: expect.stringMatching(/^order_/),
      storeId,
      customerId: customer.id,
      totalAmount: 16_900,
      currency: "DZD",
      status: "pending_confirmation",
      source: "messenger",
      // Delivery details default to the customer's.
      delivery: { wilaya: "Blida", address: "Blida Centre", phone: "0550123456", company: null, trackingNumber: null },
    });
    expect(order.statusHistory).toEqual([{ status: "pending_confirmation", at: expect.any(String), note: null }]);
  });

  it("keeps price snapshots when the catalog price changes later", async () => {
    const product = await createProduct(client, storeId, { name: "Sale item", price: 3000 });
    const order = await newOrder({ items: [{ productId: product.id, quantity: 1 }] });
    await client.patch(`/api/v1/stores/${storeId}/products/${product.id}`, { price: 9999 });
    const fetched = (await client.get(`${url()}/${order.id}`)).body.data;
    expect(fetched.items[0].unitPrice).toBe(3000);
    expect(fetched.totalAmount).toBe(3000);
  });

  it("can be created as draft but never directly as confirmed or shipped", async () => {
    expect((await newOrder({ status: "draft" })).status).toBe("draft");
    for (const status of ["confirmed", "shipped", "delivered"]) {
      expect((await client.post(url(), { customerId: customer.id, items: [{ productId: shoes.id, quantity: 1 }], status })).status).toBe(400);
    }
  });

  it("does not accept dispatch details at creation", async () => {
    const order = await newOrder({ delivery: { wilaya: "Oran", company: "Yalidine", trackingNumber: "T1" } });
    expect(order.delivery).toMatchObject({ wilaya: "Oran", company: null, trackingNumber: null });
  });

  it("rejects a customer from another store", async () => {
    const foreignCustomer = await createCustomer(client, otherStoreId);
    const res = await client.post(url(), { customerId: foreignCustomer.id, items: [{ productId: shoes.id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "INVALID_REFERENCE", details: { field: "customerId" } });
  });

  it("rejects unknown customers and products, and products from another store", async () => {
    const foreignProduct = await createProduct(client, otherStoreId);
    for (const body of [
      { customerId: "customer_unknown", items: [{ productId: shoes.id, quantity: 1 }] },
      { customerId: customer.id, items: [{ productId: "product_unknown", quantity: 1 }] },
      { customerId: customer.id, items: [{ productId: foreignProduct.id, quantity: 1 }] },
    ]) {
      const res = await client.post(url(), body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
    }
    expect(storage.orders.count((o) => o.items.some((i) => i.productId === foreignProduct.id))).toBe(0);
  });

  it("validates quantities, options and stock", async () => {
    const invalid = [
      { items: [] },
      { items: [{ productId: shoes.id, quantity: 0 }] },
      { items: [{ productId: shoes.id, quantity: 1.5 }] },
      { items: [{ productId: shoes.id, quantity: -1 }] },
    ];
    for (const body of invalid) {
      expect((await client.post(url(), { customerId: customer.id, ...body })).status).toBe(400);
    }
    const badSize = await client.post(url(), { customerId: customer.id, items: [{ productId: shoes.id, size: 47, quantity: 1 }] });
    expect(badSize.status).toBe(400);
    expect(badSize.body.error.details[0].path).toBe("items.0.size");

    const tooMany = await client.post(url(), { customerId: customer.id, items: [{ productId: boots.id, quantity: 3 }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: [{ requested: 3, available: 2 }] });
  });

  it("does not deduct stock", async () => {
    await newOrder({ items: [{ productId: boots.id, quantity: 2 }] });
    expect(storage.products.findById(boots.id)?.stock).toBe(2);
  });
});

describe("order listing", () => {
  it("lists newest first and filters by status, customer and date", async () => {
    const draft = await newOrder({ status: "draft" });
    const all = (await client.get(`${url()}?limit=100`)).body.data;
    expect(all.items[0].id).toBe(draft.id);
    expect(all.pagination.total).toBeGreaterThan(1);

    const drafts = (await client.get(`${url()}?status=draft&limit=100`)).body.data.items;
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((o: { status: string }) => o.status === "draft")).toBe(true);

    const byCustomer = (await client.get(`${url()}?customerId=${customer.id}&limit=100`)).body.data.items;
    expect(byCustomer.every((o: { customerId: string }) => o.customerId === customer.id)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect((await client.get(`${url()}?from=${today}&to=${today}&limit=100`)).body.data.pagination.total).toBe(all.pagination.total);
    expect((await client.get(`${url()}?to=2000-01-01`)).body.data.pagination.total).toBe(0);
    expect((await client.get(`${url()}?from=2030-01-01`)).body.data.pagination.total).toBe(0);
  });

  it("validates filters", async () => {
    expect((await client.get(`${url()}?status=lost`)).status).toBe(400);
    expect((await client.get(`${url()}?from=yesterday`)).status).toBe(400);
    expect((await client.get(`${url()}?from=2026-02-01&to=2026-01-01`)).status).toBe(400);
  });

  it("never returns another store's orders", async () => {
    const otherCustomer = await createCustomer(client, otherStoreId);
    const otherProduct = await createProduct(client, otherStoreId);
    const foreign = (
      await client.post(url(otherStoreId), { customerId: otherCustomer.id, items: [{ productId: otherProduct.id, quantity: 1 }] })
    ).body.data;
    const ids = (await client.get(`${url()}?limit=100`)).body.data.items.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(foreign.id);
    expect((await client.get(`${url()}/${foreign.id}`)).status).toBe(404);
    expect((await setStatus(foreign.id, "cancelled")).status).toBe(404);
  });
});

describe("order updates", () => {
  it("re-prices items from the catalog when they change", async () => {
    const order = await newOrder();
    const res = await client.patch(`${url()}/${order.id}`, { items: [{ productId: shoes.id, size: 40, quantity: 3, unitPrice: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalAmount: 13_500, items: [{ size: 40, quantity: 3, unitPrice: 4500 }] });
  });

  it("updates delivery details and notes", async () => {
    const order = await newOrder();
    const res = await client.patch(`${url()}/${order.id}`, { delivery: { address: "Rue 1", phone: "+213 770 00 00 00" }, notes: "Call first" });
    expect(res.body.data.delivery).toMatchObject({ wilaya: "Blida", address: "Rue 1", phone: "0770000000" });
    expect(res.body.data.notes).toBe("Call first");
  });

  it("does not change status through the details endpoint", async () => {
    const order = await newOrder();
    const res = await client.patch(`${url()}/${order.id}`, { status: "delivered", notes: "x" });
    expect(res.body.data.status).toBe("pending_confirmation");
  });

  it("locks items once confirmed and the address once shipped", async () => {
    const order = await newOrder();
    expect((await setStatus(order.id, "confirmed")).status).toBe(200);
    const itemsChange = await client.patch(`${url()}/${order.id}`, { items: [{ productId: shoes.id, quantity: 2 }] });
    expect(itemsChange.status).toBe(409);
    expect(itemsChange.body.error.code).toBe("BUSINESS_RULE_VIOLATION");

    await setStatus(order.id, "pending_dispatch");
    await client.patch(`${url()}/${order.id}`, { delivery: { company: "Yalidine" } });
    await setStatus(order.id, "shipped");
    expect((await client.patch(`${url()}/${order.id}`, { delivery: { address: "Elsewhere" } })).status).toBe(409);
    expect((await client.patch(`${url()}/${order.id}`, { delivery: { trackingNumber: "YAL-123" } })).status).toBe(200);
  });
});

describe("order status", () => {
  it("follows the full lifecycle and records history", async () => {
    const order = await newOrder();
    expect((await setStatus(order.id, "confirmed", "Customer confirmed by phone")).body.data.status).toBe("confirmed");
    await setStatus(order.id, "pending_dispatch");

    const shipWithoutCourier = await setStatus(order.id, "shipped");
    expect(shipWithoutCourier.status).toBe(409);
    expect(shipWithoutCourier.body.error.details.missingFields).toEqual(["delivery.company"]);

    await client.patch(`${url()}/${order.id}`, { delivery: { company: "EcoTrack" } });
    await setStatus(order.id, "shipped");
    const delivered = (await setStatus(order.id, "delivered")).body.data;
    expect(delivered.statusHistory.map((h: { status: string }) => h.status)).toEqual([
      "pending_confirmation",
      "confirmed",
      "pending_dispatch",
      "shipped",
      "delivered",
    ]);
    expect(delivered.statusHistory[1].note).toBe("Customer confirmed by phone");
  });

  it("rejects invalid transitions", async () => {
    const order = await newOrder();
    for (const status of ["shipped", "delivered", "pending_confirmation"]) {
      const res = await setStatus(order.id, status);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    }
    expect((await setStatus(order.id, "unknown")).status).toBe(400);
    await setStatus(order.id, "cancelled");
    expect((await setStatus(order.id, "confirmed")).status).toBe(409);
  });

  it("requires complete delivery details and product options to confirm", async () => {
    const bare = await createCustomer(client, storeId, { phone: null, wilaya: null, address: null });
    const order = await newOrder({ customerId: bare.id, items: [{ productId: shoes.id, quantity: 1 }] });
    const res = await setStatus(order.id, "confirmed");
    expect(res.status).toBe(409);
    expect(res.body.error.details.missingFields).toEqual([
      "delivery.wilaya",
      "delivery.address",
      "delivery.phone",
      "items.0.size",
      "items.0.color",
    ]);
    expect(storage.orders.findById(order.id)?.status).toBe("pending_confirmation");
  });

  it("re-checks stock when confirming", async () => {
    const limited = await createProduct(client, storeId, { name: "Limited", stock: 1, sizes: [], colors: [] });
    const order = await newOrder({ items: [{ productId: limited.id, quantity: 1 }] });
    await client.patch(`/api/v1/stores/${storeId}/products/${limited.id}`, { stock: 0 });
    const res = await setStatus(order.id, "confirmed");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("refuses to confirm when a product was deleted", async () => {
    const temp = await createProduct(client, storeId, { name: "Temp", sizes: [], colors: [] });
    const order = await newOrder({ items: [{ productId: temp.id, quantity: 1 }] });
    await client.delete(`/api/v1/stores/${storeId}/products/${temp.id}`);
    const res = await setStatus(order.id, "confirmed");
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ productIds: [temp.id] });
    // The order itself keeps its snapshot.
    expect((await client.get(`${url()}/${order.id}`)).body.data.items[0].productName).toBe("Temp");
  });
});
