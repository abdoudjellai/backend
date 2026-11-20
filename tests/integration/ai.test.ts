import { describe, expect, it, beforeAll } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { login, api } from "../helpers.js";
import type { Express } from "express";
import type { Api } from "../helpers.js";

let app: Express;
let client: Api;

beforeAll(async () => {
  await storage.open();
  app = createApp();
  const token = await login(app);
  client = api(app, token);
});

describe("GET /api/v1/ai/status", () => {
  it("returns configured:false when AI env vars are not set", async () => {
    const res = await client.get("/api/v1/ai/status");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(false);
  });

  it("requires authentication", async () => {
    const res = await (await import("supertest")).default(app).get("/api/v1/ai/status");
    expect(res.status).toBe(401);
  });
});
