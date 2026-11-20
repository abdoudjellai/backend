import { existsSync } from "node:fs";
import { z } from "zod";

/**
 * Environment configuration, validated once at startup.
 *
 * Only variables the application actually reads are validated here. Variables for later
 * milestones (n8n, Meta) are documented in .env.example and added when their code lands.
 */

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/** Placeholder values from .env.example that must never be used in production. */
const PLACEHOLDER_SECRETS = new Set(["change-me", "replace-with-a-long-random-secret", "replace_with_long_random_secret"]);

const originSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      // An origin is scheme + host + optional port, with no path, query or hash.
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
    } catch {
      return false;
    }
  }, "must be an origin like http://localhost:3000 (no trailing slash or path)");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_BASE_URL: z.url().default("http://localhost:4000"),
    FRONTEND_ORIGIN: z
      .string()
      .min(1, "at least one origin is required")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(originSchema).min(1, "at least one origin is required")),

    // JSON file storage directory (stores.json, customers.json, ...). Relative to the working directory.
    DATA_DIR: z.string().trim().min(1).default("./data"),

    // The single predefined business-owner account (no registration in this prototype).
    ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email("must be a valid email address")),
    ADMIN_PASSWORD: z.string().min(8, "must be at least 8 characters").max(200),
    ADMIN_ID: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "may contain only letters, digits, _ and - (max 64)")
      .default("owner_001"),
    ADMIN_NAME: z.string().trim().min(1).max(100).default("Store Owner"),

    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
    JWT_ACCESS_EXPIRES_IN: z
      .string()
      .trim()
      .regex(/^\d+[smhd]$/, 'must look like "15m", "8h" or "7d"')
      .default("8h"),

    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

    // --- AI provider (AIGrid / OpenAI-compatible) ---
    AI_PROVIDER: z.string().trim().min(1).default("aigrid"),
    AI_BASE_URL: z.string().trim().url("must be a valid URL").optional(),
    AI_API_KEY: z.string().trim().min(1).optional(),
    AI_MODEL: z.string().trim().min(1).default("Qwen/Qwen3.8-27B"),

    // --- Telegram Bot ---
    TELEGRAM_BOT_TOKEN: z.string().trim().min(1).optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    TELEGRAM_BOT_USERNAME: z.string().trim().min(1).optional(),
    TELEGRAM_DEFAULT_STORE_ID: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;
    for (const key of ["ADMIN_PASSWORD", "JWT_ACCESS_SECRET"] as const) {
      if (PLACEHOLDER_SECRETS.has(value[key])) {
        ctx.addIssue({ code: "custom", path: [key], message: "must be changed from the .env.example placeholder in production" });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/** Parse a raw environment object. Pure — safe to call from tests. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  // Treat empty strings as "not set" so defaults apply to blank lines copied from .env.example.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    // Report variable names and rule violations only — never echo values, which may be secrets.
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new EnvValidationError(issues);
  }
  return result.data;
}

function loadEnv(): Env {
  // Tests supply their own environment and must never pick up a developer's local .env.
  if (process.env.NODE_ENV !== "test" && existsSync(".env")) {
    // Does not override variables already set in the real environment.
    process.loadEnvFile(".env");
  }
  return parseEnv(process.env);
}

export const env: Env = loadEnv();
