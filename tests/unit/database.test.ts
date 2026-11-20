import { describe, expect, it } from "vitest";
import { redactMongoUri } from "../../src/config/database.js";

describe("redactMongoUri", () => {
  it("removes credentials", () => {
    expect(redactMongoUri("mongodb+srv://admin:p%40ss@cluster0.example.net/db")).toBe(
      "mongodb+srv://[REDACTED]@cluster0.example.net/db",
    );
  });

  it("leaves URIs without credentials untouched", () => {
    expect(redactMongoUri("mongodb://127.0.0.1:27017/confirmely_ai")).toBe("mongodb://127.0.0.1:27017/confirmely_ai");
  });
});
