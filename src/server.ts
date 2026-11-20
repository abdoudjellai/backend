import type { Server } from "node:http";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: Server | undefined;
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "Shutting down");

  // Force exit if connections refuse to drain.
  setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    }
    await disconnectDatabase();
    logger.info("Shutdown complete");
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    exitCode = 1;
  }
  process.exit(exitCode);
}

async function main(): Promise<void> {
  // Fail fast: do not accept traffic until MongoDB, the source of truth, is reachable.
  await connectDatabase(env.MONGODB_URI, {
    serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  });

  const app = createApp();
  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, `Confirmely backend listening on ${env.API_BASE_URL}`);
  });
  server.on("error", (error) => {
    logger.fatal({ err: error }, "HTTP server error");
    void shutdown("server_error", 1);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT", 0));
process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

main().catch((error: unknown) => {
  // Log name + message only: driver errors embed large topology descriptions.
  const err = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
  logger.fatal({ err }, "Failed to start server");
  void shutdown("startup_failure", 1);
});
