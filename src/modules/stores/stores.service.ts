import { storage } from "../../storage/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { byCreatedAtDesc, paginate, type Page } from "../../shared/utils/pagination.js";
import type { Store } from "./store.model.js";
import type { CreateStoreInput, UpdateStoreInput } from "./stores.validation.js";

export function listStores(ownerId: string, page: number, limit: number): Page<Store> {
  const stores = storage.stores.findAll((store) => store.ownerId === ownerId).sort(byCreatedAtDesc);
  return paginate(stores, page, limit);
}

/** The store, if it exists and belongs to `ownerId`; otherwise 404 (never 403, to avoid leaking IDs). */
export function getOwnedStore(ownerId: string, storeId: string): Store {
  const store = storage.stores.findOne((candidate) => candidate.id === storeId && candidate.ownerId === ownerId);
  if (store === undefined) throw AppError.notFound("Store not found");
  return store;
}

export async function createStore(ownerId: string, input: CreateStoreInput): Promise<Store> {
  return storage.stores.create({ name: input.name, description: input.description, ownerId });
}

export async function updateStore(store: Store, input: UpdateStoreInput): Promise<Store> {
  const updated = await storage.stores.update(store.id, input);
  if (updated === undefined) throw AppError.notFound("Store not found");
  return updated;
}

/**
 * Delete a store only when it holds no business data, so customers, products, orders and
 * analyses are never orphaned or silently destroyed.
 */
export async function deleteStore(store: Store): Promise<void> {
  const inStore = (record: { storeId: string }) => record.storeId === store.id;
  const counts = {
    customers: storage.customers.count(inStore),
    products: storage.products.count(inStore),
    orders: storage.orders.count(inStore),
    aiAnalyses: storage.aiAnalytics.count(inStore),
  };
  if (Object.values(counts).some((count) => count > 0)) {
    throw AppError.businessRule("Only empty stores can be deleted; this store still contains data.", { counts });
  }
  await storage.stores.delete(store.id);
}
