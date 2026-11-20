import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const app = createApp();

describe("HTTP foundation", () => {
  it("returns the standard error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "Route GET /api/v1/does-not-exist not found" },
      requestId: expect.any(String),
    });
  });

  describe("request IDs", () => {
    it("generates one when absent and returns it in header and body", async () => {
      const res = await request(app).get("/nope");
      const id = res.headers["x-request-id"];
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.requestId).toBe(id);
    });

    it("propagates a safe caller-supplied ID", async () => {
      const res = await request(app).get("/nope").set("X-Request-Id", "n8n-exec-123");
      expect(res.headers["x-request-id"]).toBe("n8n-exec-123");
      expect(res.body.requestId).toBe("n8n-exec-123");
    });

    it("replaces an unsafe caller-supplied ID", async () => {
      const res = await request(app).get("/nope").set("X-Request-Id", "bad id <script>");
      expect(res.headers["x-request-id"]).not.toBe("bad id <script>");
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("security headers", () => {
    it("sets Helmet headers and hides X-Powered-By", async () => {
      const res = await request(app).get("/nope");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["strict-transport-security"]).toBeDefined();
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("CORS", () => {
    it("allows an allowlisted origin", async () => {
      const res = await request(app).get("/nope").set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(res.headers["access-control-expose-headers"]).toBe("X-Request-Id");
    });

    it("does not allow an unknown origin", async () => {
      const res = await request(app).get("/nope").set("Origin", "https://evil.example");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("answers preflight for allowlisted origins", async () => {
      const res = await request(app)
        .options("/api/v1/anything")
        .set("Origin", "http://localhost:3000")
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });
  });

  describe("body parsing", () => {
    it("rejects malformed JSON with 400 and no internal details", async () => {
      const res = await request(app)
        .post("/api/v1/anything")
        .set("Content-Type", "application/json")
        .send('{"broken": ');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({ code: "BAD_REQUEST", message: "Malformed JSON body" });
    });

    it("rejects bodies over the size limit with 413", async () => {
      const res = await request(app)
        .post("/api/v1/anything")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ text: "x".repeat(200 * 1024) }));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });
});
