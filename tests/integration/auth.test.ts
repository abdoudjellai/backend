import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LOGIN_RATE_LIMIT } from "../../src/modules/auth/auth.routes.js";
import { storage } from "../../src/storage/index.js";
import { TEST_CREDENTIALS, login } from "../helpers.js";

const app = createApp();
const secret = new TextEncoder().encode("test-only-secret-that-is-at-least-32-characters-long");

beforeAll(async () => {
  await storage.open();
});

afterAll(async () => {
  await storage.close();
});

function sign(claims: { sub?: string; email?: string }, options: { exp?: string | number; key?: Uint8Array; issuer?: string } = {}) {
  let jwt = new SignJWT({ email: claims.email ?? "owner@test.local" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? "confirmely-backend")
    .setAudience("confirmely-dashboard")
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "1h");
  if (claims.sub !== undefined) jwt = jwt.setSubject(claims.sub);
  return jwt.sign(options.key ?? secret);
}

describe("POST /api/v1/auth/login", () => {
  it("returns a JWT and the owner profile for valid credentials", async () => {
    const res = await request(app).post("/api/v1/auth/login").send(TEST_CREDENTIALS);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      tokenType: "Bearer",
      accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      expiresAt: expect.any(String),
      user: { id: "owner_test", email: "owner@test.local", name: "Test Owner", role: "owner" },
    });
    expect(JSON.stringify(res.body)).not.toContain(TEST_CREDENTIALS.password);
  });

  it("accepts the email case-insensitively", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ ...TEST_CREDENTIALS, email: "OWNER@Test.Local" });
    expect(res.status).toBe(200);
  });

  it.each([
    ["wrong password", { email: TEST_CREDENTIALS.email, password: "wrong-password" }],
    ["unknown email", { email: "someone@else.com", password: TEST_CREDENTIALS.password }],
  ])("rejects %s with the same generic error", async (_label, body) => {
    const res = await request(app).post("/api/v1/auth/login").send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
  });

  it("validates the request body", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not offer registration", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(TEST_CREDENTIALS);
    expect(res.status).toBe(404);
  });

  it(`rate limits after ${LOGIN_RATE_LIMIT.limit} attempts`, async () => {
    const limitedApp = createApp();
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) {
      await request(limitedApp).post("/api/v1/auth/login").send({ ...TEST_CREDENTIALS, password: "wrong" });
    }
    const res = await request(limitedApp).post("/api/v1/auth/login").send(TEST_CREDENTIALS);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("GET /api/v1/auth/me and protected routes", () => {
  it("returns the owner for a valid token", async () => {
    const token = await login(app);
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "owner_test", email: "owner@test.local", name: "Test Owner", role: "owner" });
  });

  it("rejects a missing token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it.each(["Basic abc", "Bearer", "Bearer not a token", "token-without-scheme"])("rejects malformed header %j", async (header) => {
    const res = await request(app).get("/api/v1/stores").set("Authorization", header);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await request(app).get("/api/v1/stores").set("Authorization", "Bearer abc.def.ghi");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid access token");
  });

  it("rejects a token signed with another secret", async () => {
    const token = await sign({ sub: "owner_test" }, { key: new TextEncoder().encode("x".repeat(40)) });
    const res = await request(app).get("/api/v1/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = await sign({ sub: "owner_test" }, { exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request(app).get("/api/v1/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Access token expired");
  });

  it("rejects a token for a different owner or issuer", async () => {
    for (const token of [
      await sign({ sub: "owner_other" }),
      await sign({ sub: "owner_test" }, { issuer: "someone-else" }),
      await sign({}),
    ]) {
      const res = await request(app).get("/api/v1/stores").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it("requires authentication on every business endpoint", async () => {
    for (const url of [
      "/api/v1/stores",
      "/api/v1/stores/store_001",
      "/api/v1/stores/store_001/customers",
      "/api/v1/stores/store_001/products",
      "/api/v1/stores/store_001/orders",
      "/api/v1/stores/store_001/ai-analytics",
      "/api/v1/stores/store_001/analytics/overview",
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(401);
    }
  });
});
