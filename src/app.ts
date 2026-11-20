import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { createApiRouter } from "./routes/index.js";

/** Maximum accepted JSON body size. AI callbacks and webhooks are small, bounded payloads. */
export const JSON_BODY_LIMIT = "100kb";

/**
 * Build the Express application. Does not connect to the database or listen on a port,
 * so tests can exercise it directly with Supertest.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // Log method + path only: no headers (Authorization, cookies, signatures) and no query
      // string (e.g. Meta's hub.verify_token) ever reach the logs.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split("?")[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        // pino-http attaches a synthetic error to every 5xx request log; keep it compact.
        // Real errors are logged once, with their stack, by the central error handler.
        err: (err: Error) => ({ type: err.name, message: err.message }),
      },
      customLogLevel: (_req, res, error) => {
        if (error !== undefined || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(helmet());

  const allowedOrigins = new Set(env.FRONTEND_ORIGIN);
  app.use(
    cors({
      // Requests without an Origin header (curl, n8n, Meta webhooks) are not CORS requests
      // and pass through; browser origins must be on the explicit allowlist.
      origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.has(origin)),
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use("/health", healthRouter);
  app.use("/api/v1", createApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
