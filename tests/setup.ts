import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Runs before each test file's modules are imported, so src/config/env.ts sees this value.
const dataDir = join(tmpdir(), `confirmely-test-${randomUUID()}`);
process.env.DATA_DIR = dataDir;

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});
