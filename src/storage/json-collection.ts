import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

/** Fields managed by the storage layer on every record. */
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** What callers provide when creating a record. */
export type NewRecord<T extends BaseRecord> = Omit<T, keyof BaseRecord>;

/** A change to an existing record: a partial object, or a function computing one from the current record. */
export type RecordChange<T extends BaseRecord> =
  | Partial<NewRecord<T>>
  | ((current: Readonly<T>) => Partial<NewRecord<T>>);

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

const recordsSchema = z.array(z.looseObject({ id: z.string().min(1) }));

// OneDrive, antivirus or editors can briefly lock files on Windows; retry the rename.
const RETRYABLE_FS_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 5;

/**
 * One collection persisted as a JSON array in one file.
 *
 * - Records are kept in memory and every change is written to disk before it becomes visible.
 * - Writes to the file are serialized through a queue, so concurrent requests never overwrite
 *   each other, and each write is atomic (temp file + rename).
 * - Reads return deep copies, so callers cannot change stored data by mutating results.
 * - Filtering uses predicate functions written in code, never query objects from request input.
 *
 * Single process only: two server instances on the same files would overwrite each other.
 * Business modules use this class, never the files, so it can be replaced by MongoDB later.
 */
export class JsonCollection<T extends BaseRecord> {
  private records: T[] = [];
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    /** Collection name used in error messages (never a full path). */
    readonly name: string,
    private readonly filePath: string,
    private readonly idPrefix: string,
  ) {}

  /** Load the file, creating it as an empty array if missing. Fails on malformed content. */
  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      await this.persist([]);
    }
    const raw = await readFile(this.filePath, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new StorageError(
        `Storage file "${this.name}.json" contains malformed JSON. Fix or delete the file; it was not modified.`,
      );
    }
    const result = recordsSchema.safeParse(json);
    if (!result.success) {
      throw new StorageError(
        `Storage file "${this.name}.json" must contain an array of records that each have a string "id".`,
      );
    }
    this.records = result.data as unknown as T[];
    this.loaded = true;
  }

  /** Wait until every queued write has been saved. */
  async flush(): Promise<void> {
    await this.queue;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.loaded) return false;
    try {
      await access(this.filePath, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  findAll(predicate?: (record: Readonly<T>) => boolean): T[] {
    this.assertLoaded();
    const matches = predicate === undefined ? this.records : this.records.filter(predicate);
    return structuredClone(matches);
  }

  findOne(predicate: (record: Readonly<T>) => boolean): T | undefined {
    this.assertLoaded();
    const match = this.records.find(predicate);
    return match === undefined ? undefined : structuredClone(match);
  }

  findById(id: string): T | undefined {
    return this.findOne((record) => record.id === id);
  }

  count(predicate?: (record: Readonly<T>) => boolean): number {
    this.assertLoaded();
    return predicate === undefined ? this.records.length : this.records.filter(predicate).length;
  }

  /**
   * Create a record with a generated ID and timestamps.
   * `guard` runs inside the write lock with the current records; throw from it to abort
   * (e.g. a duplicate check), so check-then-insert cannot race.
   */
  async create(input: NewRecord<T>, guard?: (records: readonly Readonly<T>[]) => void): Promise<T> {
    return this.write((records) => {
      guard?.(records);
      const now = new Date().toISOString();
      const record = { ...input, id: this.generateId(), createdAt: now, updatedAt: now } as T;
      records.push(record);
      return record;
    });
  }

  /**
   * Update a record. Returns undefined when it does not exist. When `change` is a function it runs
   * inside the write lock with the current record; throw from it to abort without saving.
   * `id` and `createdAt` can never be changed.
   */
  async update(
    id: string,
    change: RecordChange<T>,
    guard?: (records: readonly Readonly<T>[]) => void,
  ): Promise<T | undefined> {
    return this.write((records) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (current === undefined) return undefined;
      guard?.(records);
      const patch = typeof change === "function" ? change(current) : change;
      const updated = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      } as T;
      records[index] = updated;
      return updated;
    });
  }

  /** Delete a record. Returns false when it does not exist. */
  async delete(id: string, guard?: (record: Readonly<T>) => void): Promise<boolean> {
    return this.write((records) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (current === undefined) return false;
      guard?.(current);
      records.splice(index, 1);
      return true;
    });
  }

  private generateId(): string {
    return `${this.idPrefix}_${randomUUID().replaceAll("-", "")}`;
  }

  /** Run `mutate` on a draft copy under the write lock; save it, then make it visible. */
  private async write<R>(mutate: (records: T[]) => R): Promise<R> {
    this.assertLoaded();
    const run = async (): Promise<R> => {
      const draft = structuredClone(this.records);
      const result = mutate(draft);
      await this.persist(draft);
      this.records = draft;
      return structuredClone(result);
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new StorageError(`Storage collection "${this.name}" is not loaded`);
    }
  }

  private async persist(records: readonly T[]): Promise<void> {
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(tempPath, this.filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt < RENAME_ATTEMPTS && code !== undefined && RETRYABLE_FS_CODES.has(code)) {
          await delay(50 * attempt);
          continue;
        }
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    }
  }
}
