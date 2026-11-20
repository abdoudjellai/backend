import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";

const app = createApp();

afterAll(async () => {
  await storage.close();
});

describe("GET /health", () => {
  it("returns 503 before storage is open", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error.details.checks.storage).toBe("unavailable");
  });

  it("returns 200 once storage is open, and initializes every JSON file", async () => {
    await storage.open();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", checks: { storage: "ok" } });

    const files = (await readdir(storage.directory)).sort();
    expect(files).toEqual(["ai-analytics.json", "customers.json", "orders.json", "products.json", "stores.json"]);
    for (const file of files) {
      expect(JSON.parse(await readFile(join(storage.directory, file), "utf8"))).toEqual([]);
    }
  });

  it("returns 503 when a storage file disappears, without exposing file paths", async () => {
    await rm(join(storage.directory, "orders.json"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(storage.directory);
  });
});
