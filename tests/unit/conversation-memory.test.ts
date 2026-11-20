import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationMemory } from "../../src/modules/ai/memory/conversation-memory.js";

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory(1000); // 1 second TTL for tests
  });

  afterEach(() => {
    memory.stopCleanup();
  });

  it("creates a session key from storeId and telegramUserId", () => {
    expect(ConversationMemory.sessionKey("store_1", "tg_123")).toBe("store_1:tg_123");
  });

  it("creates a new session on getOrCreate", () => {
    const session = memory.getOrCreate("store_1:tg_123");
    expect(session.messages).toEqual([]);
    expect(session.orderDraft.confirmed).toBe(false);
    expect(memory.size).toBe(1);
  });

  it("returns the same session on repeated getOrCreate", () => {
    const s1 = memory.getOrCreate("store_1:tg_123");
    s1.messages.push({ role: "user", content: "hello" });
    const s2 = memory.getOrCreate("store_1:tg_123");
    expect(s2.messages).toHaveLength(1);
  });

  it("isolates sessions by key", () => {
    memory.addMessage("store_1:tg_A", { role: "user", content: "from A" });
    memory.addMessage("store_1:tg_B", { role: "user", content: "from B" });

    expect(memory.get("store_1:tg_A")!.messages[0]!.content).toBe("from A");
    expect(memory.get("store_1:tg_B")!.messages[0]!.content).toBe("from B");
  });

  it("caps messages at max limit", () => {
    const key = "store_1:tg_cap";
    for (let i = 0; i < 50; i++) {
      memory.addMessage(key, { role: "user", content: `msg ${i}` });
    }
    expect(memory.get(key)!.messages.length).toBeLessThanOrEqual(40);
    expect(memory.get(key)!.messages.at(-1)!.content).toBe("msg 49");
  });

  it("expires sessions after TTL", async () => {
    memory.addMessage("store_1:tg_ttl", { role: "user", content: "hi" });
    expect(memory.get("store_1:tg_ttl")).toBeDefined();

    await new Promise((r) => setTimeout(r, 1100));

    expect(memory.get("store_1:tg_ttl")).toBeUndefined();
  });

  it("updates and resets the order draft", () => {
    const key = "store_1:tg_draft";
    memory.updateDraft(key, { customerName: "Amine", wilaya: "Blida" });
    expect(memory.get(key)!.orderDraft.customerName).toBe("Amine");
    expect(memory.get(key)!.orderDraft.wilaya).toBe("Blida");

    memory.resetDraft(key);
    expect(memory.get(key)!.orderDraft.customerName).toBeNull();
    expect(memory.get(key)!.orderDraft.items).toEqual([]);
  });

  it("deletes a session", () => {
    memory.addMessage("store_1:tg_del", { role: "user", content: "hi" });
    expect(memory.size).toBe(1);

    memory.delete("store_1:tg_del");
    expect(memory.size).toBe(0);
    expect(memory.get("store_1:tg_del")).toBeUndefined();
  });
});
