import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { login, api, createStore, createProduct, createCustomer, type Api } from "../helpers.js";

let app: Express;
let token: string;
let client: Api;
let storeId: string;
let orderId: string;

beforeAll(async () => {
  await storage.open();
  app = createApp();
  token = await login(app);
  client = api(app, token);
  storeId = await createStore(client);
  const product = await createProduct(client, storeId);
  const customer = await createCustomer(client, storeId);

  const orderRes = await client.post(`/api/v1/stores/${storeId}/orders`, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 1 }],
    delivery: { wilaya: "Algiers", address: "Test address", phone: "0550000000" },
    status: "pending_confirmation",
    source: "manual",
  });
  orderId = orderRes.body.data.id;
});

describe("POST /api/v1/stores/:storeId/orders/:orderId/analyze", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post(`/api/v1/stores/${storeId}/orders/${orderId}/analyze`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent order", async () => {
    const res = await client.post(`/api/v1/stores/${storeId}/orders/ord_doesnotexist/analyze`);
    expect(res.status).toBe(404);
  });

  it("returns 409 when AI is not configured (after finding the order)", async () => {
    const res = await client.post(`/api/v1/stores/${storeId}/orders/${orderId}/analyze`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("AI provider is not configured");
  });
});
