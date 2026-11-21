import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { login, api, createStore, type Api } from "../helpers.js";

let app: Express;
let token: string;
let client: Api;

beforeAll(async () => {
  await storage.open();
  app = createApp();
  token = await login(app);
  client = api(app, token);
  await createStore(client);
});

describe("POST /api/v1/ai/chat", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/ai/chat").send({ message: "hello" });
    expect(res.status).toBe(401);
  });

  it("rejects empty message", async () => {
    const res = await client.post("/api/v1/ai/chat", { message: "" });
    expect(res.status).toBe(400);
  });

  it("rejects missing message", async () => {
    const res = await client.post("/api/v1/ai/chat", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/ai/chat/reset", () => {
  it("resets the dashboard session", async () => {
    const res = await client.post("/api/v1/ai/chat/reset");
    expect(res.status).toBe(200);
    expect(res.body.data.reset).toBe(true);
  });
});
