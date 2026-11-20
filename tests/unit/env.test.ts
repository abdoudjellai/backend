import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../../src/config/env.js";

const valid = {
  NODE_ENV: "development",
  PORT: "4000",
  FRONTEND_ORIGIN: "http://localhost:3000",
  MONGODB_URI: "mongodb://127.0.0.1:27017/confirmely_ai",
  LOG_LEVEL: "debug",
};

describe("parseEnv", () => {
  it("parses a valid environment and coerces types", () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toEqual(["http://localhost:3000"]);
    expect(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS).toBe(10_000);
  });

  it("applies defaults for optional variables, including blank values", () => {
    const env = parseEnv({ FRONTEND_ORIGIN: valid.FRONTEND_ORIGIN, MONGODB_URI: valid.MONGODB_URI, PORT: "" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("parses a comma-separated CORS allowlist", () => {
    const env = parseEnv({ ...valid, FRONTEND_ORIGIN: "http://localhost:3000, https://app.example.com" });
    expect(env.FRONTEND_ORIGIN).toEqual(["http://localhost:3000", "https://app.example.com"]);
  });

  it.each([
    ["missing MONGODB_URI", { MONGODB_URI: undefined }, "MONGODB_URI"],
    ["non-mongo URI", { MONGODB_URI: "postgres://localhost/db" }, "MONGODB_URI"],
    ["non-numeric PORT", { PORT: "abc" }, "PORT"],
    ["out-of-range PORT", { PORT: "70000" }, "PORT"],
    ["invalid NODE_ENV", { NODE_ENV: "staging" }, "NODE_ENV"],
    ["origin with a path", { FRONTEND_ORIGIN: "http://localhost:3000/app" }, "FRONTEND_ORIGIN"],
    ["origin with trailing slash", { FRONTEND_ORIGIN: "http://localhost:3000/" }, "FRONTEND_ORIGIN"],
    ["wildcard origin", { FRONTEND_ORIGIN: "*" }, "FRONTEND_ORIGIN"],
  ])("rejects %s", (_label, override, variable) => {
    expect(() => parseEnv({ ...valid, ...override })).toThrow(EnvValidationError);
    try {
      parseEnv({ ...valid, ...override });
    } catch (error) {
      expect((error as EnvValidationError).issues.some((issue) => issue.startsWith(variable))).toBe(true);
    }
  });

  it("does not echo variable values in error messages", () => {
    const secretLooking = "postgres://admin:SuperSecret123@db.internal/prod";
    try {
      parseEnv({ ...valid, MONGODB_URI: secretLooking });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SuperSecret123");
    }
  });
});
