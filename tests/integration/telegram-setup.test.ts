import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { login, api, type Api } from "../helpers.js";

let app: Express;
let token: string;
let client: Api;

beforeAll(async () => {
  await storage.open();
  app = createApp();
  token = await login(app);
  client = api(app, token);
});

describe("GET /api/v1/telegram/status", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/telegram/status");
    expect(res.status).toBe(401);
  });

  it("reports unconfigured when no bot token is set", async () => {
    const res = await client.get("/api/v1/telegram/status");
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
  });
});

describe("POST /api/v1/telegram/setup-webhook", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/telegram/setup-webhook").send({});
    expect(res.status).toBe(401);
  });

  it("fails when bot token is not configured", async () => {
    const res = await client.post("/api/v1/telegram/setup-webhook", {});
    expect(res.status).toBe(409);
  });
});
