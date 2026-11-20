import type { Express } from "express";
import request from "supertest";

export const TEST_CREDENTIALS = { email: "owner@test.local", password: "test-password-123" };

export async function login(app: Express): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send(TEST_CREDENTIALS);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

/** Supertest helpers that send the bearer token. */
export function api(app: Express, token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string, body?: object) => request(app).post(url).set(auth).send(body),
    patch: (url: string, body?: object) => request(app).patch(url).set(auth).send(body),
    delete: (url: string) => request(app).delete(url).set(auth),
  };
}

export type Api = ReturnType<typeof api>;

let counter = 0;

export async function createStore(client: Api, name = `Store ${++counter}`): Promise<string> {
  const res = await client.post("/api/v1/stores", { name });
  if (res.status !== 201) throw new Error(`createStore failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export async function createProduct(client: Api, storeId: string, overrides: object = {}): Promise<{ id: string; price: number }> {
  const res = await client.post(`/api/v1/stores/${storeId}/products`, {
    name: "Black Shoes",
    description: "Black casual shoes",
    price: 4500,
    stock: 20,
    sizes: [40, 41, 42, 43],
    colors: ["Black", "White"],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createCustomer(client: Api, storeId: string, overrides: object = {}): Promise<{ id: string }> {
  const res = await client.post(`/api/v1/stores/${storeId}/customers`, {
    name: "Amine",
    phone: `055${String(100_0000 + ++counter).padStart(7, "0")}`,
    wilaya: "Blida",
    address: "Blida Centre",
    source: "messenger",
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
