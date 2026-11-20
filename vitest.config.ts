import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests never read a local .env file; they get an isolated, explicit config.
    env: {
      NODE_ENV: "test",
      PORT: "4000",
      FRONTEND_ORIGIN: "http://localhost:3000",
      // Placeholder only — integration tests connect to an in-memory MongoDB instance.
      MONGODB_URI: "mongodb://127.0.0.1:27017/confirmely_ai_test_unused",
      LOG_LEVEL: "silent",
    },
    testTimeout: 30_000,
    // First run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 180_000,
  },
});
