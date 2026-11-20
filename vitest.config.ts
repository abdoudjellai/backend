import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Gives every test file its own temporary DATA_DIR (never ./data), removed afterwards.
    setupFiles: ["tests/setup.ts"],
    // Tests never read a local .env file; they get an isolated, explicit config with fake credentials.
    env: {
      NODE_ENV: "test",
      PORT: "4000",
      FRONTEND_ORIGIN: "http://localhost:3000",
      ADMIN_ID: "owner_test",
      ADMIN_NAME: "Test Owner",
      ADMIN_EMAIL: "owner@test.local",
      ADMIN_PASSWORD: "test-password-123",
      JWT_ACCESS_SECRET: "test-only-secret-that-is-at-least-32-characters-long",
      JWT_ACCESS_EXPIRES_IN: "1h",
      LOG_LEVEL: "silent",
    },
    testTimeout: 30_000,
  },
});
