import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { storage } from "../../src/storage/index.js";
import { login, api, createStore, type Api } from "../helpers.js";
import { getConversation, deleteConversation, listConversations, chat } from "../../src/modules/owner-assistant/owner-assistant.service.js";

let app: Express;
let client: Api;
let storeId: string;

beforeAll(async () => {
  await storage.open();
  app = createApp();
  const token = await login(app);
  client = api(app, token);
  storeId = await createStore(client);
});

describe("POST /api/v1/owner-assistant/chat", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/owner-assistant/chat").send({ message: "hello" });
    expect(res.status).toBe(401);
  });

  it("rejects an empty message", async () => {
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when AI is not configured", async () => {
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "How is my business?" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("AI provider is not configured");
  });
});

describe("conversation management (via service)", () => {
  it("persists conversations and messages, enforces ownership, and supports deletion", async () => {
    const auth = { ownerId: "owner_test" } as const;

    const created = await storage.ownerConversations.create({
      ownerId: auth.ownerId,
      storeId,
      assistantType: "owner",
      title: "Test conversation",
    });
    await storage.ownerMessages.create({ conversationId: created.id, storeId, role: "user", content: "hello" });

    expect(listConversations(auth.ownerId).map((c) => c.id)).toContain(created.id);
    const fetched = getConversation(auth.ownerId, created.id);
    expect(fetched.conversation.title).toBe("Test conversation");
    expect(fetched.messages).toHaveLength(1);

    // Another owner cannot read or delete it (404, not 403).
    expect(() => getConversation("owner_other", created.id)).toThrow(/not found/i);
    await expect(deleteConversation("owner_other", created.id)).rejects.toThrow(/not found/i);
    expect(listConversations("owner_other")).toHaveLength(0);

    await deleteConversation(auth.ownerId, created.id);
    expect(listConversations(auth.ownerId)).toHaveLength(0);
    expect(storage.ownerMessages.count((m) => m.conversationId === created.id)).toBe(0);
  });
});

describe("GET /api/v1/owner-assistant/conversations", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/owner-assistant/conversations");
    expect(res.status).toBe(401);
  });

  it("returns the owner's conversations (409-free when AI is unconfigured)", async () => {
    const res = await client.get("/api/v1/owner-assistant/conversations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.conversations)).toBe(true);
  });
});

describe("GET /api/v1/owner-assistant/conversations/:id", () => {
  it("returns 404 for a conversation that does not belong to the owner", async () => {
    const res = await client.get("/api/v1/owner-assistant/conversations/conversation_doesnotexist");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/owner-assistant/conversations/:id", () => {
  it("returns 404 for a foreign conversation ID", async () => {
    const res = await client.delete("/api/v1/owner-assistant/conversations/conversation_doesnotexist");
    expect(res.status).toBe(404);
  });
});

describe("chat() AI-unconfigured guard", () => {
  it("throws the business-rule error before touching AI", async () => {
    await expect(chat({ ownerId: "owner_test" } as never, undefined, "hello")).rejects.toThrow(/AI provider is not configured/);
  });
});
