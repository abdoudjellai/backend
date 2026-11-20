/**
 * Load demo data for the configured owner: one store with products, customers, orders and AI
 * analyses. Run with `npm run seed` while the server is STOPPED (the storage is single-process).
 *
 * Everything is created through the real services, so the demo data obeys the same validation
 * and business rules as API requests (catalog prices, store scoping, status transitions).
 * Does nothing if the owner already has a store.
 */
import { env } from "../config/env.js";
import { createAiAnalysis } from "../modules/ai-analytics/ai-analytics.service.js";
import { createAiAnalysisSchema } from "../modules/ai-analytics/ai-analytics.validation.js";
import { createCustomer } from "../modules/customers/customers.service.js";
import { createCustomerSchema } from "../modules/customers/customers.validation.js";
import { createOrder, updateOrder, updateOrderStatus } from "../modules/orders/orders.service.js";
import { createOrderSchema, updateOrderSchema, updateOrderStatusSchema } from "../modules/orders/orders.validation.js";
import type { OrderStatus } from "../modules/orders/order-status.js";
import { createProduct } from "../modules/products/products.service.js";
import { createProductSchema } from "../modules/products/products.validation.js";
import { createStore } from "../modules/stores/stores.service.js";
import { createStoreSchema } from "../modules/stores/stores.validation.js";
import { storage } from "../storage/index.js";

async function seed(): Promise<void> {
  await storage.open();
  const ownerId = env.ADMIN_ID;

  if (storage.stores.count((store) => store.ownerId === ownerId) > 0) {
    console.log(`Owner ${ownerId} already has a store — nothing seeded. Delete the files in ${storage.directory} to start over.`);
    return;
  }

  const store = await createStore(
    ownerId,
    createStoreSchema.parse({ name: "Demo Shoes Store", description: "Chaussures et bottes, livraison 58 wilayas" }),
  );

  const product = async (input: unknown) => createProduct(store.id, createProductSchema.parse(input));
  const blackShoes = await product({
    name: "Black Shoes",
    description: "Black casual shoes",
    price: 4500,
    stock: 20,
    sizes: [40, 41, 42, 43],
    colors: ["Black", "White"],
  });
  const boots = await product({
    name: "Leather Boots",
    description: "Winter leather boots",
    price: 7900,
    stock: 6,
    sizes: [41, 42, 43, 44],
    colors: ["Brown"],
  });
  const tshirt = await product({ name: "Cotton T-Shirt", price: 1800, stock: 40, sizes: ["S", "M", "L", "XL"], colors: ["White", "Navy"] });

  const customer = async (input: unknown) => createCustomer(store.id, createCustomerSchema.parse(input));
  const amine = await customer({
    name: "Amine B.",
    phone: "0550123456",
    wilaya: "Blida",
    address: "Blida Centre",
    source: "messenger",
    platformCustomerId: "DEMO_PSID_1001",
  });
  const sara = await customer({ name: "Sara K.", phone: "+213 661 23 45 67", wilaya: "Alger", address: "Bab Ezzouar", source: "instagram" });
  const yacine = await customer({ name: "Yacine M.", phone: "0770 11 22 33", wilaya: "Oran", address: "Es Senia", source: "manual" });

  const order = async (input: unknown, path: OrderStatus[] = [], courier?: string) => {
    let created = await createOrder(store.id, createOrderSchema.parse(input));
    for (const status of path) {
      if (status === "shipped" && courier !== undefined) {
        created = await updateOrder(store.id, created.id, updateOrderSchema.parse({ delivery: { company: courier } }));
      }
      created = await updateOrderStatus(store.id, created.id, updateOrderStatusSchema.parse({ status }));
    }
    return created;
  };

  const o1 = await order(
    { customerId: amine.id, items: [{ productId: blackShoes.id, size: 42, color: "Black", quantity: 2 }], source: "messenger" },
    ["confirmed", "pending_dispatch", "shipped", "delivered"],
    "Yalidine",
  );
  const o2 = await order(
    { customerId: sara.id, items: [{ productId: boots.id, size: 41, color: "Brown", quantity: 1 }], source: "instagram" },
    ["confirmed", "pending_dispatch", "shipped", "refused"],
    "EcoTrack",
  );
  const o3 = await order({ customerId: yacine.id, items: [{ productId: tshirt.id, size: "L", color: "Navy", quantity: 3 }] }, ["confirmed"]);
  // An AI-extracted order still waiting for the customer's confirmation (size not chosen yet).
  const o4 = await order({ customerId: amine.id, items: [{ productId: boots.id, quantity: 1 }], source: "messenger" });

  const analysis = async (input: unknown) => createAiAnalysis(store.id, createAiAnalysisSchema.parse(input));
  await analysis({ orderId: o1.id, returnRisk: 0.18, riskLevel: "low", recommendedCourier: "Yalidine", recommendations: ["Standard delivery"] });
  await analysis({
    orderId: o2.id,
    returnRisk: 0.72,
    riskLevel: "high",
    recommendedCourier: "EcoTrack",
    recommendations: ["Verify customer phone number", "Confirm delivery address"],
  });
  await analysis({ orderId: o3.id, returnRisk: 0.41, riskLevel: "medium", recommendedCourier: "Yalidine", recommendations: ["Call before dispatch"] });
  await analysis({ orderId: o4.id, returnRisk: 0.35, riskLevel: "medium", recommendedCourier: null, recommendations: ["Ask the customer for a size"] });

  await storage.close();
  console.log(`Seeded store ${store.id} for owner ${ownerId}:`, storage.counts());
}

seed().catch((error: unknown) => {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
