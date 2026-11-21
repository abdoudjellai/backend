import { describe, it, expect } from "vitest";
import { getCourierQuotes, recommendCourier } from "../../src/modules/ai/courier-quotes.js";

describe("getCourierQuotes", () => {
  it("returns quotes for a known wilaya", () => {
    const quotes = getCourierQuotes("Blida");
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes[0]!.name).toBe("Yalidine");
  });

  it("is case-insensitive", () => {
    const quotes = getCourierQuotes("ALGIERS");
    expect(quotes.length).toBeGreaterThan(0);
  });

  it("returns default quotes for an unknown wilaya", () => {
    const quotes = getCourierQuotes("SomeUnknownPlace");
    expect(quotes.length).toBeGreaterThan(0);
  });

  it("returns default quotes for null", () => {
    const quotes = getCourierQuotes(null);
    expect(quotes.length).toBeGreaterThan(0);
  });
});

describe("recommendCourier", () => {
  it("recommends a courier for a known wilaya", () => {
    const rec = recommendCourier("Blida");
    expect(rec.recommended).toBeTruthy();
    expect(rec.reason).toContain("DA");
    expect(rec.reason).toContain("Blida");
  });

  it("recommends a courier for null wilaya", () => {
    const rec = recommendCourier(null);
    expect(rec.recommended).toBeTruthy();
    expect(rec.reason).toBeTruthy();
  });

  it("picks the courier with highest success rate", () => {
    const rec = recommendCourier("Algiers");
    expect(rec.recommended).toBe("Yalidine");
  });
});
