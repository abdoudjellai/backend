import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  await storage.open();
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/v1/telegram/webhook", () => {
  it("returns 200 for a valid update", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .send({
        update_id: 90001,
        message: {
          message_id: 1,
          from: { id: 55555, is_bot: false, first_name: "Test" },
          chat: { id: 55555, type: "private" },
          date: 1700000000,
          text: "Hello",
        },
      });

    // Webhook always responds 200 immediately.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("accepts requests when TELEGRAM_WEBHOOK_SECRET is not configured (dev mode)", async () => {
    // In test env, TELEGRAM_WEBHOOK_SECRET is not set, so validation is disabled.
    const { validateWebhookSecret } = await import("../../src/modules/telegram/telegram.utils.js");

    // With no secret configured, any value passes (dev convenience).
    expect(validateWebhookSecret("any-value")).toBe(true);
    expect(validateWebhookSecret(undefined)).toBe(true);
  });

  it("returns 400 for malformed updates", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .send({ not_an_update: true });

    expect(res.status).toBe(400);
  });

  it("handles updates without a message gracefully", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .send({ update_id: 90002 });

    // Acknowledged — unsupported types are silently ignored.
    expect(res.status).toBe(200);
  });

  it("does not require JWT authentication", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .send({ update_id: 90003 });

    // Should NOT be 401.
    expect(res.status).not.toBe(401);
  });
});
