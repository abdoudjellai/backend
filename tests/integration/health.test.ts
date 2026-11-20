import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from "../../src/config/database.js";

// An isolated, throwaway MongoDB instance — never a real database.
let mongo: MongoMemoryServer;
const app = createApp();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
});

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

describe("GET /health", () => {
  it("returns 503 before the database is connected", async () => {
    expect(getDatabaseStatus()).toBe("disconnected");
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error.details.checks.database).toBe("disconnected");
  });

  it("returns 200 with database status once connected", async () => {
    await connectDatabase(mongo.getUri(), { serverSelectionTimeoutMS: 5_000 });
    expect(getDatabaseStatus()).toBe("connected");

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        status: "ok",
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        checks: { database: "connected" },
      },
      requestId: expect.any(String),
    });
    expect(new Date(res.body.data.timestamp).toISOString()).toBe(res.body.data.timestamp);
  });

  it("returns 503 again after the database disconnects", async () => {
    await disconnectDatabase();
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.error.details.checks.database).toBe("disconnected");
  });
});

describe("connectDatabase", () => {
  it("rejects when MongoDB is unreachable instead of hanging", async () => {
    // Port 1 is reserved and will refuse connections.
    await expect(
      connectDatabase("mongodb://127.0.0.1:1/unreachable", { serverSelectionTimeoutMS: 1_000 }),
    ).rejects.toThrow();
    expect(getDatabaseStatus()).toBe("disconnected");
  });
});
