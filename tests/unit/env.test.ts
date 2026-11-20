import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../../src/config/env.js";

const valid = {
  NODE_ENV: "development",
  PORT: "4000",
  FRONTEND_ORIGIN: "http://localhost:3000",
  DATA_DIR: "./data",
  ADMIN_EMAIL: "Owner@Confirmely.ai",
  ADMIN_PASSWORD: "change-me",
  JWT_ACCESS_SECRET: "x".repeat(40),
  LOG_LEVEL: "debug",
};

function issuesFor(raw: Record<string, string | undefined>): string[] {
  try {
    parseEnv(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).issues;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses a valid environment, coerces types and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toEqual(["http://localhost:3000"]);
    expect(env.DATA_DIR).toBe("./data");
    expect(env.ADMIN_EMAIL).toBe("owner@confirmely.ai");
    expect(env.ADMIN_ID).toBe("owner_001");
    expect(env.ADMIN_NAME).toBe("Store Owner");
    expect(env.JWT_ACCESS_EXPIRES_IN).toBe("8h");
  });

  it("treats blank values as unset", () => {
    const env = parseEnv({ ...valid, PORT: "", LOG_LEVEL: "", DATA_DIR: "" });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATA_DIR).toBe("./data");
  });

  it("parses a comma-separated CORS allowlist", () => {
    const env = parseEnv({ ...valid, FRONTEND_ORIGIN: "http://localhost:3000, https://app.example.com" });
    expect(env.FRONTEND_ORIGIN).toEqual(["http://localhost:3000", "https://app.example.com"]);
  });

  it.each([
    ["missing FRONTEND_ORIGIN", { FRONTEND_ORIGIN: undefined }, "FRONTEND_ORIGIN"],
    ["missing ADMIN_EMAIL", { ADMIN_EMAIL: undefined }, "ADMIN_EMAIL"],
    ["invalid ADMIN_EMAIL", { ADMIN_EMAIL: "not-an-email" }, "ADMIN_EMAIL"],
    ["missing ADMIN_PASSWORD", { ADMIN_PASSWORD: undefined }, "ADMIN_PASSWORD"],
    ["short ADMIN_PASSWORD", { ADMIN_PASSWORD: "short" }, "ADMIN_PASSWORD"],
    ["missing JWT_ACCESS_SECRET", { JWT_ACCESS_SECRET: undefined }, "JWT_ACCESS_SECRET"],
    ["short JWT_ACCESS_SECRET", { JWT_ACCESS_SECRET: "too-short" }, "JWT_ACCESS_SECRET"],
    ["bad JWT_ACCESS_EXPIRES_IN", { JWT_ACCESS_EXPIRES_IN: "forever" }, "JWT_ACCESS_EXPIRES_IN"],
    ["bad ADMIN_ID", { ADMIN_ID: "owner/../etc" }, "ADMIN_ID"],
    ["non-numeric PORT", { PORT: "abc" }, "PORT"],
    ["invalid NODE_ENV", { NODE_ENV: "staging" }, "NODE_ENV"],
    ["origin with a path", { FRONTEND_ORIGIN: "http://localhost:3000/app" }, "FRONTEND_ORIGIN"],
    ["wildcard origin", { FRONTEND_ORIGIN: "*" }, "FRONTEND_ORIGIN"],
  ])("rejects %s", (_label, override, variable) => {
    expect(issuesFor({ ...valid, ...override }).some((issue) => issue.startsWith(variable))).toBe(true);
  });

  it("rejects placeholder secrets in production only", () => {
    const placeholders = { ...valid, ADMIN_PASSWORD: "change-me", JWT_ACCESS_SECRET: "replace-with-a-long-random-secret" };
    expect(() => parseEnv(placeholders)).not.toThrow();
    const issues = issuesFor({ ...placeholders, NODE_ENV: "production" });
    expect(issues.some((issue) => issue.startsWith("ADMIN_PASSWORD"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("JWT_ACCESS_SECRET"))).toBe(true);
  });

  it("does not echo variable values in error messages", () => {
    try {
      parseEnv({ ...valid, JWT_ACCESS_SECRET: "SuperSecret123" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SuperSecret123");
    }
  });
});
