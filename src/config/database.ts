import mongoose from "mongoose";
import { logger } from "./logger.js";

/**
 * Global Mongoose safety settings.
 * - strictQuery: drop filter fields that are not in the schema.
 * - sanitizeFilter: wrap `$`-operators found in query filters in `$eq`, so values that come
 *   from request input (e.g. `{ "$ne": null }`) cannot inject query operators.
 *   Use `mongoose.trusted()` for the rare filter that must contain operators built in code.
 */
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

export type DatabaseStatus = "disconnected" | "connected" | "connecting" | "disconnecting";

const READY_STATES: Record<number, DatabaseStatus> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

let listenersAttached = false;

function attachConnectionListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  const connection = mongoose.connection;
  connection.on("connected", () => logger.info("MongoDB connected"));
  connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
  connection.on("reconnected", () => logger.info("MongoDB reconnected"));
  connection.on("error", (error: Error) => logger.error({ err: { name: error.name, message: error.message } }, "MongoDB connection error"));
}

/** Strip credentials from a connection string so it is safe to log. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, "//[REDACTED]@");
}

export interface ConnectOptions {
  serverSelectionTimeoutMS: number;
}

/**
 * Connect to MongoDB. Rejects if the server cannot be reached within the selection timeout;
 * after a successful initial connection the driver reconnects automatically.
 */
export async function connectDatabase(uri: string, options: ConnectOptions): Promise<void> {
  attachConnectionListeners();
  logger.info({ uri: redactMongoUri(uri) }, "Connecting to MongoDB");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function getDatabaseStatus(): DatabaseStatus {
  return READY_STATES[mongoose.connection.readyState] ?? "disconnected";
}
