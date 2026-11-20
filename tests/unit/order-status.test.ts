import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  assertTransitionAllowed,
  missingFieldsFor,
  ORDER_STATUSES,
  type StatusCheckOrder,
} from "../../src/modules/orders/order-status.js";

const completeOrder: StatusCheckOrder = {
  items: [{ size: 42, color: "Black", productOptions: { hasSizes: true, hasColors: true } }],
  delivery: { wilaya: "Blida", address: "Blida Centre", phone: "0550123456", company: null },
};

describe("order status transitions", () => {
  it("defines transitions for every status", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it.each([
    ["draft", "pending_confirmation"],
    ["pending_confirmation", "confirmed"],
    ["pending_confirmation", "draft"],
    ["confirmed", "pending_dispatch"],
    ["pending_dispatch", "shipped"],
    ["shipped", "delivered"],
    ["shipped", "refused"],
    ["delivered", "returned"],
    ["refused", "returned"],
    ["confirmed", "cancelled"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(() => assertTransitionAllowed(from, to)).not.toThrow();
  });

  it.each([
    ["draft", "confirmed"],
    ["draft", "shipped"],
    ["pending_confirmation", "shipped"],
    ["confirmed", "delivered"],
    ["shipped", "cancelled"],
    ["delivered", "shipped"],
    ["cancelled", "confirmed"],
    ["returned", "delivered"],
    ["confirmed", "confirmed"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertTransitionAllowed(from, to)).toThrow(expect.objectContaining({ code: "INVALID_STATUS_TRANSITION", statusCode: 409 }));
  });

  it("final statuses allow no transitions", () => {
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual([]);
    expect(ALLOWED_TRANSITIONS.returned).toEqual([]);
  });
});

describe("missingFieldsFor", () => {
  it("needs nothing for draft, pending_confirmation or cancelled", () => {
    const empty: StatusCheckOrder = {
      items: [{ size: null, color: null, productOptions: { hasSizes: true, hasColors: true } }],
      delivery: { wilaya: null, address: null, phone: null, company: null },
    };
    expect(missingFieldsFor("pending_confirmation", empty)).toEqual([]);
    expect(missingFieldsFor("draft", empty)).toEqual([]);
    expect(missingFieldsFor("cancelled", empty)).toEqual([]);
  });

  it("requires delivery details and product options to confirm", () => {
    const incomplete: StatusCheckOrder = {
      items: [
        { size: null, color: "Black", productOptions: { hasSizes: true, hasColors: true } },
        { size: null, color: null, productOptions: { hasSizes: false, hasColors: false } },
      ],
      delivery: { wilaya: "Blida", address: null, phone: null, company: null },
    };
    expect(missingFieldsFor("confirmed", incomplete)).toEqual(["delivery.address", "delivery.phone", "items.0.size"]);
    expect(missingFieldsFor("confirmed", completeOrder)).toEqual([]);
  });

  it("requires a delivery company to ship", () => {
    expect(missingFieldsFor("shipped", completeOrder)).toEqual(["delivery.company"]);
    expect(missingFieldsFor("shipped", { ...completeOrder, delivery: { ...completeOrder.delivery, company: "Yalidine" } })).toEqual([]);
  });
});
