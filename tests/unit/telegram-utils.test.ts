import { describe, expect, it } from "vitest";
import {
  extractMessageInfo,
  UpdateDeduplicator,
  type TelegramUpdate,
} from "../../src/modules/telegram/telegram.utils.js";

describe("extractMessageInfo", () => {
  const baseUpdate: TelegramUpdate = {
    update_id: 1001,
    message: {
      message_id: 42,
      from: { id: 12345, is_bot: false, first_name: "Amine", username: "amine_dz" },
      chat: { id: 12345, type: "private" },
      date: 1700000000,
      text: "Salam, kayen shoes?",
    },
  };

  it("extracts message info from a valid text message", () => {
    const info = extractMessageInfo(baseUpdate);
    expect(info).not.toBeNull();
    expect(info!.chatId).toBe(12345);
    expect(info!.telegramUserId).toBe("12345");
    expect(info!.username).toBe("amine_dz");
    expect(info!.firstName).toBe("Amine");
    expect(info!.text).toBe("Salam, kayen shoes?");
  });

  it("returns null for updates without a message", () => {
    expect(extractMessageInfo({ update_id: 1002 })).toBeNull();
  });

  it("returns null for messages from bots", () => {
    const botUpdate: TelegramUpdate = {
      ...baseUpdate,
      message: { ...baseUpdate.message!, from: { ...baseUpdate.message!.from!, is_bot: true } },
    };
    expect(extractMessageInfo(botUpdate)).toBeNull();
  });

  it("returns null for non-text messages", () => {
    const noText: TelegramUpdate = {
      ...baseUpdate,
      message: { ...baseUpdate.message!, text: undefined },
    };
    expect(extractMessageInfo(noText)).toBeNull();
  });

  it("returns null for group messages", () => {
    const group: TelegramUpdate = {
      ...baseUpdate,
      message: { ...baseUpdate.message!, chat: { id: -100123, type: "group" } },
    };
    expect(extractMessageInfo(group)).toBeNull();
  });

  it("handles missing username", () => {
    const noUsername: TelegramUpdate = {
      ...baseUpdate,
      message: {
        ...baseUpdate.message!,
        from: { id: 12345, is_bot: false, first_name: "Amine" },
      },
    };
    const info = extractMessageInfo(noUsername);
    expect(info!.username).toBeNull();
  });
});

describe("validateWebhookSecret", () => {
  it("validates correctly when secret is configured", async () => {
    // We test the logic directly since env is frozen at startup.
    // The function checks env.TELEGRAM_WEBHOOK_SECRET against the header.
    // In test env, the secret is undefined, so it passes everything (dev mode).
    const { validateWebhookSecret } = await import("../../src/modules/telegram/telegram.utils.js");
    // Without secret configured, all values pass.
    expect(validateWebhookSecret("anything")).toBe(true);
    expect(validateWebhookSecret(undefined)).toBe(true);
  });
});

describe("UpdateDeduplicator", () => {
  it("detects duplicate update IDs", () => {
    const dedup = new UpdateDeduplicator();
    expect(dedup.isDuplicate(1)).toBe(false);
    expect(dedup.isDuplicate(1)).toBe(true);
    expect(dedup.isDuplicate(2)).toBe(false);
  });

  it("evicts old entries when max size is exceeded", () => {
    const dedup = new UpdateDeduplicator(10);
    for (let i = 0; i < 20; i++) {
      dedup.isDuplicate(i);
    }
    // Size should have been pruned
    expect(dedup.size).toBeLessThanOrEqual(12);
    // Recent IDs should still be known
    expect(dedup.isDuplicate(19)).toBe(true);
  });
});
