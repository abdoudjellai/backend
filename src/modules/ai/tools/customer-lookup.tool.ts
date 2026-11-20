import { storage } from "../../../storage/index.js";
import type { Customer } from "../../customers/customer.model.js";

export interface CustomerLookupInput {
  storeId: string;
  telegramUserId: string;
}

export interface CustomerLookupResult {
  found: boolean;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    wilaya: string | null;
    address: string | null;
  } | null;
}

export function lookupCustomer(input: CustomerLookupInput): CustomerLookupResult {
  const customer = storage.customers.findOne(
    (c: Readonly<Customer>) =>
      c.storeId === input.storeId &&
      c.source === "telegram" &&
      c.platformCustomerId === input.telegramUserId,
  );

  if (customer === undefined) {
    return { found: false, customer: null };
  }

  return {
    found: true,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      wilaya: customer.wilaya,
      address: customer.address,
    },
  };
}

export const CUSTOMER_LOOKUP_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "lookup_customer",
    description: "Look up an existing customer by their Telegram identity. Returns their saved details if found.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};
