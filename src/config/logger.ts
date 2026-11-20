import { pino, type LoggerOptions } from "pino";
import { env } from "./env.js";

/**
 * Paths that must never appear in logs. Request/response headers are not logged at all
 * (see the pino-http serializers in app.ts); this list is defence in depth for anything
 * passed to the logger explicitly.
 */
export const REDACT_PATHS = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "pageAccessToken",
  "secret",
  "authorization",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.pageAccessToken",
  "*.secret",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  'headers["x-hub-signature-256"]',
  "req.headers.authorization",
  "req.headers.cookie",
] as const;

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "confirmely-backend", env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
};

// Human-readable logs in development only; structured JSON everywhere else.
if (env.NODE_ENV === "development") {
  options.transport = {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service,env" },
  };
}

export const logger = pino(options);
