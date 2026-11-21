import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";
import type { AiCompletionOptions, AiCompletionResult } from "../../src/modules/ai/providers/aigrid.provider.js";

// The test env has no AI credentials: mock the shared AI service so the full HTTP → service →
// agent loop → tools → storage path runs against a scripted model. No network calls are made.
vi.mock("../../src/modules/ai/ai.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/ai/ai.service.js")>();
  return { ...actual, isAiConfigured: () => true, aiComplete: vi.fn() };
});

const { aiComplete, AiProviderError } = await import("../../src/modules/ai/ai.service.js");
const { createApp } = await import("../../src/app.js");
const { storage } = await import("../../src/storage/index.js");
const { login, api, createStore, createCustomer, createProduct } = await import("../helpers.js");
const { CHAT_RATE_LIMIT } = await import("../../src/modules/owner-assistant/owner-assistant.validation.js");

const mockComplete = vi.mocked(aiComplete);

type Api = ReturnType<typeof api>;
let app: Express;
let client: Api;
let storeId: string;
const OTHER_OWNER = "owner_someone_else";

const sent: AiCompletionOptions[] = [];

function reply(content: string | null, toolCalls: { id: string; name: string; args?: object }[] = []): AiCompletionResult {
  return {
    content,
    toolCalls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })),
    model: "test",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  };
}

function script(...responses: (AiCompletionResult | Error)[]): void {
  for (const response of responses) {
    mockComplete.mockImplementationOnce(async (options) => {
      sent.push(structuredClone(options));
      if (response instanceof Error) throw response;
      return response;
    });
  }
}

/** The JSON tool results the model received in the latest request. */
const toolResultsSent = (): Record<string, any>[] =>
  (sent.at(-1)?.messages ?? []).filter((m) => m.role === "tool").map((m) => JSON.parse(m.content!) as Record<string, any>);

beforeAll(async () => {
  await storage.open();
  app = createApp();
  client = api(app, await login(app));
  storeId = await createStore(client, "My Shoe Shop");
  const product = await createProduct(client, storeId);
  const customer = await createCustomer(client, storeId, { name: "Amine" });
  const created = await client.post(`/api/v1/stores/${storeId}/orders`, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2, size: 42, color: "Black" }],
    delivery: { wilaya: "Blida", address: "Rue 1", phone: "0550123456" },
    source: "manual",
  });
  expect(created.status).toBe(201);

  // Another owner's store and order, written directly (the app has a single login account).
  const foreignStore = await storage.stores.create({ name: "Foreign Shop", ownerId: OTHER_OWNER, description: null });
  await storage.orders.create({
    storeId: foreignStore.id,
    customerId: "customer_foreign",
    items: [{ productId: "product_f", productName: "Foreign Item", size: null, color: null, quantity: 1, unitPrice: 77_777, lineTotal: 77_777 }],
    totalAmount: 77_777,
    currency: "DZD",
    delivery: { wilaya: "Alger", address: null, phone: null, company: null, trackingNumber: null },
    status: "delivered",
    source: "manual",
    notes: null,
    statusHistory: [{ status: "delivered", at: new Date().toISOString(), note: null }],
  });
});

beforeEach(() => {
  sent.length = 0;
  mockComplete.mockReset();
});

describe("POST /api/v1/owner-assistant/chat", () => {
  it("answers a simple question without tools and creates a conversation (201)", async () => {
    script(reply("Hello! How can I help with your business today?"));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Hello" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      createdConversation: true,
      message: { role: "assistant", content: "Hello! How can I help with your business today?", toolsUsed: [] },
      toolsUsed: [],
    });
    expect(res.body.data.conversationId).toMatch(/^conversation_/);
    expect(res.body.data.message.createdAt).toBeTypeOf("string");

    const system = sent[0]!.messages[0]!.content!;
    expect(system).toContain("Confirmely AI Business Assistant");
    expect(system).toContain('"My Shoe Shop"');
    expect(system).toMatch(/Today is \w+day \d{4}-\d{2}-\d{2}/);
    expect(sent[0]!.tools!.map((t) => t.function.name)).toContain("get_revenue_summary");
    // The owner agent never sees the customer agent's tools.
    expect(sent[0]!.tools!.map((t) => t.function.name)).not.toContain("create_order");
  });

  it("runs a tool with real store data, and a follow-up reuses the conversation and period", async () => {
    script(
      reply(null, [{ id: "c1", name: "get_orders_summary", args: { period: "this_month" } }]),
      reply("You received 1 order this month."),
    );
    const first = await client.post("/api/v1/owner-assistant/chat", { message: "How many orders did I receive this month?" });
    expect(first.status).toBe(201);
    expect(first.body.data.toolsUsed).toEqual(["get_orders_summary"]);
    const [summary] = toolResultsSent();
    expect(summary!.totalOrders).toBe(1);
    expect(summary!.period.label).toBe("This month");
    const conversationId = first.body.data.conversationId as string;

    script(
      reply(null, [{ id: "c2", name: "get_return_analysis", args: { period: "this_month" } }]),
      reply("None of this month's orders were returned."),
    );
    const second = await client.post("/api/v1/owner-assistant/chat", { conversationId, message: "How many were returned?" });
    expect(second.status).toBe(200);
    expect(second.body.data.createdConversation).toBe(false);

    const followUp = sent[2]!; // sent[0..1] belong to the first question
    // History carries the previous turn, and the prompt lists the earlier tool call with its period.
    expect(followUp.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(followUp.messages[2]!.content).toBe("You received 1 order this month.");
    expect(followUp.messages[0]!.content).toContain('get_orders_summary {"period":"this_month"}');

    const history = await client.get(`/api/v1/owner-assistant/conversations/${conversationId}`);
    expect(history.status).toBe(200);
    expect(history.body.data.conversation).toMatchObject({ id: conversationId, messageCount: 4, assistantType: "owner" });
    expect(history.body.data.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history.body.data.messages[3].toolsUsed).toEqual(["get_return_analysis"]);
  });

  it("handles several tools in one question (compare periods)", async () => {
    script(
      reply(null, [
        { id: "a", name: "compare_business_periods", args: {} },
        { id: "b", name: "get_revenue_summary", args: { period: "last_month" } },
      ]),
      reply("This month is ahead of last month."),
    );
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Compare this month with last month." });
    expect(res.status).toBe(201);
    expect(res.body.data.toolsUsed).toEqual(["compare_business_periods", "get_revenue_summary"]);
    const [comparison, revenue] = toolResultsSent();
    expect(comparison!.current.period.label).toBe("This month");
    expect(comparison!.previous.period.label).toBe("Previous period");
    expect(revenue!.period.label).toBe("Last month");
  });

  it("sends the model back for data when it states figures without calling a tool", async () => {
    // Regression from a live run: late in a conversation the model answered a comparison from
    // memory and invented last month's figures.
    script(
      reply("Last month you had 10 orders and 10,000 DZD in revenue."),
      reply(null, [{ id: "g", name: "compare_business_periods" }]),
      reply("Last month had no orders, so there is no baseline yet."),
    );
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Compare this month with last month." });
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBe("Last month had no orders, so there is no baseline yet.");
    expect(res.body.data.toolsUsed).toEqual(["compare_business_periods"]);
    expect(sent[1]!.messages.at(-1)!.content).toMatch(/no business data was retrieved/);
  });

  it("does not second-guess replies without figures, or numbered lists", async () => {
    script(reply("I can only help with your own store.\n1. Ask about revenue\n2. Ask about orders"));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Show another store" });
    expect(res.status).toBe(201);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable delivery data instead of inventing it", async () => {
    script(reply(null, [{ id: "d", name: "get_delivery_performance" }]), reply("I can't determine that yet: no courier is recorded on your orders."));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Which delivery company performs best?" });
    expect(res.status).toBe(201);
    expect(toolResultsSent()[0]).toMatchObject({ available: false });
  });

  it("feeds invalid tool requests back to the model and still answers", async () => {
    script(
      reply(null, [
        { id: "x", name: "update_order_status", args: { orderId: "order_1", status: "cancelled" } },
        { id: "y", name: "get_orders_summary", args: { period: "yesterday-ish" } },
      ]),
      reply("I can only analyze your data; changes are made in the dashboard."),
    );
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Cancel order 1" });
    expect(res.status).toBe(201);
    expect(res.body.data.toolsUsed).toEqual([]); // only successful tool calls are reported
    expect(toolResultsSent().map((r) => r.error)).toEqual(["unknown_tool", "invalid_arguments"]);
  });

  it("forces an answer when the model requests too many tools", async () => {
    const loop = Array.from({ length: 5 }, (_, i) => reply(null, [{ id: `t${i}`, name: "get_business_overview" }]));
    script(...loop, reply("Here is your overview."));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "Overview please" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBe("Here is your overview.");
    expect(mockComplete).toHaveBeenCalledTimes(6);
    expect(sent[5]!.tools).toBeUndefined();
  });

  it("uses a fallback reply when the model returns no text", async () => {
    script(reply("<think>hmm</think>"));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "?" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toMatch(/could not prepare an answer/);
  });

  it("returns 502 on provider failure and persists nothing", async () => {
    const before = storage.ownerMessages.count();
    const conversationsBefore = storage.ownerConversations.count();
    script(new AiProviderError("AI provider returned HTTP 500", 500));
    const res = await client.post("/api/v1/owner-assistant/chat", { message: "How much revenue?" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_PROVIDER_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("HTTP 500");
    expect(storage.ownerMessages.count()).toBe(before);
    expect(storage.ownerConversations.count()).toBe(conversationsBefore);
  });

  it("validates the body and ignores identity fields supplied by the client", async () => {
    expect((await client.post("/api/v1/owner-assistant/chat", { message: "" })).status).toBe(400);
    expect((await client.post("/api/v1/owner-assistant/chat", { message: "x".repeat(4001) })).status).toBe(400);
    expect((await client.post("/api/v1/owner-assistant/chat", { message: "hi", conversationId: "../etc/passwd" })).status).toBe(400);

    script(reply(null, [{ id: "z", name: "get_business_overview", args: { period: "all_time" } }]), reply("ok"));
    const foreignStoreId = storage.stores.findOne((s) => s.ownerId === OTHER_OWNER)!.id;
    const res = await client.post("/api/v1/owner-assistant/chat", {
      message: "Show the other shop's numbers",
      ownerId: OTHER_OWNER,
      storeId: foreignStoreId,
      businessId: foreignStoreId,
    });
    expect(res.status).toBe(201);
    const [overview] = toolResultsSent();
    expect(overview!.metrics.totalOrders).toBe(1);
    expect(JSON.stringify(toolResultsSent())).not.toContain("77777");
    const conversation = storage.ownerConversations.findById(res.body.data.conversationId)!;
    expect(conversation).toMatchObject({ ownerId: "owner_test", storeId });
  });

  it("never exposes another business's order through order details", async () => {
    const foreignOrder = storage.orders.findOne((o) => o.totalAmount === 77_777)!;
    script(reply(null, [{ id: "o", name: "get_order_details", args: { orderId: foreignOrder.id } }]), reply("Not found."));
    await client.post("/api/v1/owner-assistant/chat", { message: `Explain order ${foreignOrder.id}` });
    expect(toolResultsSent()[0]).toMatchObject({ found: false });
  });
});

describe("conversation isolation", () => {
  it("returns 404 for another owner's conversation on chat, read and delete", async () => {
    const foreign = await storage.ownerConversations.create({ ownerId: OTHER_OWNER, storeId, assistantType: "owner", title: "Secret" });
    await storage.ownerMessages.create({ conversationId: foreign.id, storeId, role: "user", content: "private question" });

    script(reply("should not be called"));
    const chatRes = await client.post("/api/v1/owner-assistant/chat", { conversationId: foreign.id, message: "continue" });
    expect(chatRes.status).toBe(404);
    expect(mockComplete).not.toHaveBeenCalled();

    expect((await client.get(`/api/v1/owner-assistant/conversations/${foreign.id}`)).status).toBe(404);
    expect((await client.delete(`/api/v1/owner-assistant/conversations/${foreign.id}`)).status).toBe(404);
    const list = await client.get("/api/v1/owner-assistant/conversations");
    expect(list.body.data.conversations.map((c: { id: string }) => c.id)).not.toContain(foreign.id);
    expect(storage.ownerMessages.count((m) => m.conversationId === foreign.id)).toBe(1);
  });

  it("lists, reads and deletes the owner's own conversations", async () => {
    script(reply("First answer"));
    const created = await client.post("/api/v1/owner-assistant/chat", { message: "Title of this chat" });
    const id = created.body.data.conversationId as string;

    const list = await client.get("/api/v1/owner-assistant/conversations");
    expect(list.status).toBe(200);
    expect(list.body.data.conversations[0]).toMatchObject({ id, title: "Title of this chat", messageCount: 2 });
    expect(list.body.data.conversations[0]).not.toHaveProperty("ownerId");

    expect((await client.delete(`/api/v1/owner-assistant/conversations/${id}`)).status).toBe(200);
    expect((await client.get(`/api/v1/owner-assistant/conversations/${id}`)).status).toBe(404);
    expect(storage.ownerMessages.count((m) => m.conversationId === id)).toBe(0);
  });
});

describe("rate limiting", () => {
  it(`allows ${CHAT_RATE_LIMIT.limit} chat requests per minute per owner`, async () => {
    const limitedApp = createApp(); // fresh counters
    const limited = api(limitedApp, await login(limitedApp));
    mockComplete.mockResolvedValue(reply("ok"));
    const statuses: number[] = [];
    for (let i = 0; i <= CHAT_RATE_LIMIT.limit; i++) {
      statuses.push((await limited.post("/api/v1/owner-assistant/chat", { message: `q${i}` })).status);
    }
    expect(statuses.slice(0, CHAT_RATE_LIMIT.limit).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Reading history is not rate limited.
    expect((await limited.get("/api/v1/owner-assistant/conversations")).status).toBe(200);
  });
});

describe("unauthenticated access", () => {
  it("rejects every endpoint without a token", async () => {
    expect((await request(app).post("/api/v1/owner-assistant/chat").send({ message: "hi" })).status).toBe(401);
    expect((await request(app).get("/api/v1/owner-assistant/conversations")).status).toBe(401);
    expect((await request(app).get("/api/v1/owner-assistant/conversations/conversation_abc")).status).toBe(401);
    expect((await request(app).delete("/api/v1/owner-assistant/conversations/conversation_abc")).status).toBe(401);
  });
});
