import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonCollection, StorageError, type BaseRecord } from "../../src/storage/json-collection.js";
import { Storage } from "../../src/storage/storage.js";

interface Item extends BaseRecord {
  storeId: string;
  name: string;
  count: number;
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "confirmely-collection-"));
  file = join(dir, "items.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function open(): Promise<JsonCollection<Item>> {
  const collection = new JsonCollection<Item>("items", file, "item");
  await collection.load();
  return collection;
}

const readFileJson = async (): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

describe("JsonCollection loading", () => {
  it("creates a missing file as an empty array", async () => {
    const items = await open();
    expect(items.findAll()).toEqual([]);
    expect(await readFileJson()).toEqual([]);
  });

  it("fails with a meaningful error on malformed JSON and leaves the file untouched", async () => {
    await writeFile(file, "[{ broken");
    const collection = new JsonCollection<Item>("items", file, "item");
    await expect(collection.load()).rejects.toThrow(StorageError);
    await expect(collection.load()).rejects.toThrow(/"items\.json" contains malformed JSON/);
    expect(await readFile(file, "utf8")).toBe("[{ broken");
  });

  it("rejects content that is not an array of records with ids", async () => {
    await writeFile(file, JSON.stringify({ items: [] }));
    await expect(new JsonCollection<Item>("items", file, "item").load()).rejects.toThrow(/must contain an array/);
    await writeFile(file, JSON.stringify([{ name: "no id" }]));
    await expect(new JsonCollection<Item>("items", file, "item").load()).rejects.toThrow(/must contain an array/);
  });

  it("does not leak the full file path in errors", async () => {
    await writeFile(file, "nope");
    await expect(new JsonCollection<Item>("items", file, "item").load()).rejects.not.toThrow(dir);
  });

  it("refuses operations before load", () => {
    const collection = new JsonCollection<Item>("items", file, "item");
    expect(() => collection.findAll()).toThrow(/not loaded/);
  });
});

describe("JsonCollection CRUD", () => {
  it("create generates a prefixed unique id and timestamps, and persists", async () => {
    const items = await open();
    const a = await items.create({ storeId: "s1", name: "A", count: 1 });
    const b = await items.create({ storeId: "s1", name: "B", count: 2 });
    expect(a.id).toMatch(/^item_[0-9a-f]{32}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(a.updatedAt);
    expect(await readFileJson()).toEqual([a, b]);

    const reopened = await open();
    expect(reopened.findById(a.id)).toEqual(a);
  });

  it("find, findOne, findById and count filter with predicates", async () => {
    const items = await open();
    await items.create({ storeId: "s1", name: "A", count: 1 });
    await items.create({ storeId: "s2", name: "B", count: 2 });
    expect(items.findAll((i) => i.storeId === "s1").map((i) => i.name)).toEqual(["A"]);
    expect(items.findOne((i) => i.count === 2)?.name).toBe("B");
    expect(items.findById("item_missing")).toBeUndefined();
    expect(items.count()).toBe(2);
    expect(items.count((i) => i.storeId === "s2")).toBe(1);
  });

  it("update merges changes but never changes id or createdAt", async () => {
    const items = await open();
    const created = await items.create({ storeId: "s1", name: "A", count: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await items.update(created.id, { count: 5, ...({ id: "evil", createdAt: "x" } as object) });
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, name: "A", count: 5 });
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
    expect(await items.update("item_missing", { count: 1 })).toBeUndefined();
  });

  it("delete removes a record once", async () => {
    const items = await open();
    const created = await items.create({ storeId: "s1", name: "A", count: 1 });
    expect(await items.delete(created.id)).toBe(true);
    expect(await items.delete(created.id)).toBe(false);
    expect(await readFileJson()).toEqual([]);
  });

  it("returns copies, so mutating results does not change stored data", async () => {
    const items = await open();
    const created = await items.create({ storeId: "s1", name: "A", count: 1 });
    created.name = "hacked";
    const [found] = items.findAll();
    if (found !== undefined) found.name = "hacked";
    expect(items.findById(created.id)?.name).toBe("A");
  });

  it("saves nothing when a guard or change function throws", async () => {
    const items = await open();
    const created = await items.create({ storeId: "s1", name: "A", count: 1 });
    await expect(
      items.create({ storeId: "s1", name: "B", count: 1 }, () => {
        throw new Error("duplicate");
      }),
    ).rejects.toThrow("duplicate");
    await expect(
      items.update(created.id, () => {
        throw new Error("rule broken");
      }),
    ).rejects.toThrow("rule broken");
    expect(items.findAll()).toHaveLength(1);
    expect(items.findById(created.id)?.count).toBe(1);
    // The write queue keeps working after failures.
    await items.update(created.id, { count: 2 });
    expect(items.findById(created.id)?.count).toBe(2);
  });
});

describe("JsonCollection concurrency", () => {
  it("serializes concurrent creates without losing any", async () => {
    const items = await open();
    await Promise.all(Array.from({ length: 100 }, (_, i) => items.create({ storeId: "s1", name: `n${i}`, count: i })));
    expect(items.count()).toBe(100);
    expect(await readFileJson()).toHaveLength(100);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("concurrent read-modify-write updates do not overwrite each other", async () => {
    const items = await open();
    const counter = await items.create({ storeId: "s1", name: "counter", count: 0 });
    await Promise.all(
      Array.from({ length: 50 }, () => items.update(counter.id, (current) => ({ count: current.count + 1 }))),
    );
    expect(items.findById(counter.id)?.count).toBe(50);
    const reopened = await open();
    expect(reopened.findById(counter.id)?.count).toBe(50);
  });

  it("a guard inside the lock prevents duplicate inserts under concurrency", async () => {
    const items = await open();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        items.create({ storeId: "s1", name: "unique", count: 0 }, (records) => {
          if (records.some((r) => r.name === "unique")) throw new Error("duplicate");
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(items.count()).toBe(1);
  });
});

describe("Storage", () => {
  it("initializes every expected file as an empty array", async () => {
    const storage = new Storage(dir);
    expect(await storage.isHealthy()).toBe(false);
    await storage.open();
    expect((await readdir(dir)).sort()).toEqual([
      "ai-analytics.json",
      "customers.json",
      "orders.json",
      "products.json",
      "stores.json",
    ]);
    for (const name of await readdir(dir)) {
      expect(JSON.parse(await readFile(join(dir, name), "utf8"))).toEqual([]);
    }
    expect(await storage.isHealthy()).toBe(true);
    await rm(join(dir, "orders.json"));
    expect(await storage.isHealthy()).toBe(false);
  });
});
