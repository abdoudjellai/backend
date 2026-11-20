import { describe, expect, it } from "vitest";
import { normalizeAlgerianPhone } from "../../src/shared/utils/phone.js";

describe("normalizeAlgerianPhone", () => {
  it.each([
    ["0550123456", "0550123456"],
    ["0550 12 34 56", "0550123456"],
    ["0550-12-34-56", "0550123456"],
    ["0550.12.34.56", "0550123456"],
    ["+213550123456", "0550123456"],
    ["+213 550 12 34 56", "0550123456"],
    ["00213550123456", "0550123456"],
    ["213550123456", "0550123456"],
    ["0661234567", "0661234567"],
    ["0770112233", "0770112233"],
    ["021 23 45 67", "021234567"],
    ["(021) 23-45-67", "021234567"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeAlgerianPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "0550",
    "05501234567", // too long
    "0850123456", // invalid mobile prefix, wrong landline length
    "+33612345678", // French number
    "1234567890",
    "0550 12 34 5a",
  ])("rejects %s", (input) => {
    expect(normalizeAlgerianPhone(input)).toBeNull();
  });
});
