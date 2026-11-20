import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { api, createCustomer, createProduct, createStore, login, type Api } from "../helpers.js";

const app = createApp();
let client: Api;

beforeAll(async () => {
  await storage.open();
  client = api(app, await login(app));
});

afterAll(async () => {
  await storage.close();
});

/** A store with one customer and one product, plus a helper to create orders in it. */
async function setupStore() {
  const storeId = await createStore(client);
  const customer = await createCustomer(client, storeId, { phone: null, wilaya: "Blida", address: "Centre" });
  const product = await createProduct(client, storeId, { sizes: [], colors: [] });
  const order = async (quantity = 1) =>
    (await client.post(`/api/v1/stores/${storeId}/orders`, { customerId: customer.id, items: [{ productId: product.id, quantity }] })).body.data as {
      id: string;
      totalAmount: number;
    };
  const analyze = (body: object) => client.post(`/api/v1/stores/${storeId}/ai-analytics`, body);
  return { storeId, order, analyze };
}

const highRisk = {
  returnRisk: 0.72,
  riskLevel: "high",
  recommendedCourier: "EcoTrack",
  recommendations: ["Verify customer phone number", "Confirm delivery address"],
};

describe("AI analytics persistence", () => {
  it("saves an analysis for an order in the store", async () => {
    const { storeId, order, analyze } = await setupStore();
    const o = await order();
    const res = await analyze({ orderId: o.id, ...highRisk, storeId: "store_other" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: expect.stringMatching(/^analysis_/), storeId, orderId: o.id, ...highRisk });
  });

  it.each([
    ["risk above 1", { returnRisk: 1.2 }, "returnRisk"],
    ["negative risk", { returnRisk: -0.1 }, "returnRisk"],
    ["risk as string", { returnRisk: "0.5" }, "returnRisk"],
    ["unknown risk level", { riskLevel: "extreme" }, "riskLevel"],
    ["too many recommendations", { recommendations: Array.from({ length: 21 }, (_, i) => `r${i}`) }, "recommendations"],
  ])("rejects %s", async (_label, override, path) => {
    const { order, analyze } = await setupStore();
    const o = await order();
    const res = await analyze({ orderId: o.id, ...highRisk, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it("rejects an order from another store or an unknown order", async () => {
    const a = await setupStore();
    const b = await setupStore();
    const orderInB = await b.order();
    for (const orderId of [orderInB.id, "order_unknown"]) {
      const res = await a.analyze({ orderId, ...highRisk });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_REFERENCE");
    }
    expect(storage.aiAnalytics.count((x) => x.orderId === orderInB.id)).toBe(0);
  });

  it("keeps history instead of overwriting, and returns the latest per order", async () => {
    const { storeId, order, analyze } = await setupStore();
    const o = await order();
    const first = (await analyze({ orderId: o.id, ...highRisk })).body.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await analyze({ orderId: o.id, returnRisk: 0.2, riskLevel: "low" })).body.data;

    const res = await client.get(`/api/v1/stores/${storeId}/orders/${o.id}/ai-analytics`);
    expect(res.status).toBe(200);
    expect(res.body.data.latest.id).toBe(second.id);
    expect(res.body.data.history.map((a: { id: string }) => a.id)).toEqual([second.id, first.id]);
  });

  it("returns an empty history for an order without analyses and 404 for unknown orders", async () => {
    const { storeId, order } = await setupStore();
    const o = await order();
    expect((await client.get(`/api/v1/stores/${storeId}/orders/${o.id}/ai-analytics`)).body.data).toEqual({
      orderId: o.id,
      latest: null,
      history: [],
    });
    expect((await client.get(`/api/v1/stores/${storeId}/orders/order_unknown/ai-analytics`)).status).toBe(404);
  });

  it("lists analyses of the store with filters", async () => {
    const { storeId, order, analyze } = await setupStore();
    const o1 = await order();
    const o2 = await order();
    await analyze({ orderId: o1.id, ...highRisk });
    await analyze({ orderId: o2.id, returnRisk: 0.1, riskLevel: "low" });
    const all = (await client.get(`/api/v1/stores/${storeId}/ai-analytics`)).body.data;
    expect(all.pagination.total).toBe(2);
    const high = (await client.get(`/api/v1/stores/${storeId}/ai-analytics?riskLevel=high`)).body.data.items;
    expect(high.map((a: { orderId: string }) => a.orderId)).toEqual([o1.id]);
    const forO2 = (await client.get(`/api/v1/stores/${storeId}/ai-analytics?orderId=${o2.id}`)).body.data.items;
    expect(forO2).toHaveLength(1);
  });
});

describe("dashboard analytics", () => {
  it("returns zeros and nulls for an empty store", async () => {
    const storeId = await createStore(client);
    const overview = (await client.get(`/api/v1/stores/${storeId}/analytics/overview`)).body.data;
    expect(overview.business).toMatchObject({ totalOrders: 0, totalCustomers: 0, totalProducts: 0, deliveredRevenue: 0, currency: "DZD" });
    expect(overview.ai).toMatchObject({ totalAnalyses: 0, analyzedOrders: 0, averagePredictedReturnRisk: null, highRiskOrders: 0 });
    const orders = (await client.get(`/api/v1/stores/${storeId}/analytics/orders`)).body.data;
    expect(orders).toMatchObject({ totalOrders: 0, ordersByDay: [], averageDeliveredOrderValue: null, outcomes: { actualReturnRate: null } });
  });

  it("calculates business, order and AI statistics from stored data", async () => {
    const { storeId, order, analyze } = await setupStore();
    const delivered = await order(2); // 9000 DZD
    const refused = await order(1); // 4500 DZD
    const pending = await order(1);

    const advance = async (orderId: string, outcome: string) => {
      await client.patch(`/api/v1/stores/${storeId}/orders/${orderId}`, { delivery: { phone: "0550000099", company: "Yalidine" } });
      for (const status of ["confirmed", "pending_dispatch", "shipped", outcome]) {
        const res = await client.patch(`/api/v1/stores/${storeId}/orders/${orderId}/status`, { status });
        expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    };
    await advance(delivered.id, "delivered");
    await advance(refused.id, "refused");

    await analyze({ orderId: delivered.id, returnRisk: 0.9, riskLevel: "high", recommendedCourier: "EcoTrack" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await analyze({ orderId: delivered.id, returnRisk: 0.2, riskLevel: "low", recommendedCourier: "Yalidine" }); // re-analysis
    await analyze({ orderId: refused.id, returnRisk: 0.8, riskLevel: "high", recommendedCourier: "Yalidine" });

    const overview = (await client.get(`/api/v1/stores/${storeId}/analytics/overview`)).body.data;
    expect(overview.business).toMatchObject({
      totalOrders: 3,
      totalCustomers: 1,
      totalProducts: 1,
      deliveredRevenue: 9000,
      ordersByStatus: { delivered: 1, refused: 1, pending_confirmation: 1, confirmed: 0 },
    });

    const orders = (await client.get(`/api/v1/stores/${storeId}/analytics/orders`)).body.data;
    expect(orders).toMatchObject({
      totalOrders: 3,
      deliveredRevenue: 9000,
      averageDeliveredOrderValue: 9000,
      outcomes: { delivered: 1, refused: 1, returned: 0, completed: 2, actualReturnRate: 0.5 },
      ordersByDay: [{ date: new Date().toISOString().slice(0, 10), count: 3 }],
    });
    expect((await client.get(`/api/v1/stores/${storeId}/analytics/orders?to=2000-01-01`)).body.data.totalOrders).toBe(0);

    const ai = (await client.get(`/api/v1/stores/${storeId}/analytics/ai`)).body.data;
    expect(ai).toEqual({
      totalAnalyses: 3,
      analyzedOrders: 2,
      averagePredictedReturnRisk: 0.5,
      highRiskOrders: 1,
      riskDistribution: { low: 1, medium: 0, high: 1 },
      courierRecommendations: [{ courier: "Yalidine", orders: 2 }],
    });
    void pending;
  });
});
