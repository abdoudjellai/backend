import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { byCreatedAtDesc, paginate, type Page } from "../../shared/utils/pagination.js";
import type { Customer } from "./customer.model.js";
import type { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from "./customers.validation.js";

interface IdentityFields {
  phone: string | null;
  source: Customer["source"];
  platformCustomerId: string | null;
}

/**
 * Reject a customer whose reliable identifiers already belong to another customer in the same store.
 * Reliable identifiers: the normalized phone number, and the platform ID for a given source.
 * Names are never used for matching. The conflict includes the existing ID so callers (e.g. n8n)
 * can reuse that customer instead of creating a duplicate.
 */
function assertNoDuplicate(
  customers: readonly Readonly<Customer>[],
  storeId: string,
  identity: IdentityFields,
  excludeId?: string,
): void {
  for (const other of customers) {
    if (other.storeId !== storeId || other.id === excludeId) continue;
    if (identity.phone !== null && other.phone === identity.phone) {
      throw AppError.conflict("A customer with this phone number already exists in this store", {
        field: "phone",
        existingCustomerId: other.id,
      });
    }
    if (
      identity.platformCustomerId !== null &&
      other.source === identity.source &&
      other.platformCustomerId === identity.platformCustomerId
    ) {
      throw AppError.conflict("A customer with this platform ID already exists in this store", {
        field: "platformCustomerId",
        existingCustomerId: other.id,
      });
    }
  }
}

export function listCustomers(storeId: string, query: ListCustomersQuery): Page<Customer> {
  const q = query.q?.toLowerCase();
  const customers = storage.customers
    .findAll(
      (customer) =>
        customer.storeId === storeId &&
        (query.phone === undefined || customer.phone === query.phone) &&
        (query.platformCustomerId === undefined || customer.platformCustomerId === query.platformCustomerId) &&
        (query.source === undefined || customer.source === query.source) &&
        (q === undefined ||
          [customer.name, customer.phone, customer.wilaya, customer.address].some((field) =>
            field?.toLowerCase().includes(q),
          )),
    )
    .sort(byCreatedAtDesc);
  return paginate(customers, query.page, query.limit);
}

export function getCustomer(storeId: string, customerId: string): Customer {
  const customer = storage.customers.findOne((c) => c.id === customerId && c.storeId === storeId);
  if (customer === undefined) throw AppError.notFound("Customer not found");
  return customer;
}

export async function createCustomer(storeId: string, input: CreateCustomerInput): Promise<Customer> {
  // The duplicate check runs inside the write lock, so two concurrent creates cannot both pass it.
  return storage.customers.create({ ...input, storeId }, (customers) => assertNoDuplicate(customers, storeId, input));
}

export async function updateCustomer(storeId: string, customerId: string, input: UpdateCustomerInput): Promise<Customer> {
  const existing = getCustomer(storeId, customerId);
  const updated = await storage.customers.update(customerId, input, (customers) => {
    // Check the identity the record will have after the update, against everyone else.
    const current = customers.find((c) => c.id === customerId) ?? existing;
    assertNoDuplicate(customers, storeId, { ...current, ...input }, customerId);
  });
  if (updated === undefined) throw AppError.notFound("Customer not found");
  return updated;
}

/** Customers referenced by orders are kept, so order history always points to a real customer. */
export async function deleteCustomer(storeId: string, customerId: string): Promise<void> {
  getCustomer(storeId, customerId);
  const orderCount = storage.orders.count((order) => order.storeId === storeId && order.customerId === customerId);
  if (orderCount > 0) {
    throw AppError.businessRule("Customers with orders cannot be deleted", { orderCount });
  }
  await storage.customers.delete(customerId);
}
