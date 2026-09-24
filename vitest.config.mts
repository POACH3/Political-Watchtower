import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { resolveTestDatabaseUrl } from "./vitest.test-db";

// Node's built-in .env loader (no dotenv dependency needed) — DATABASE_URL
// etc. come from .env for local runs; CI sets them directly instead (see
// .github/workflows/ci.yml).
try {
  process.loadEnvFile();
} catch {
  // no .env present — fine in CI, where env vars are already set
}

// Tests never touch the dev database: workers get DATABASE_URL pointed at
// a separate `<name>_test` database that vitest.global-setup.mts drops,
// recreates and migrates before the run.
const testDatabaseUrl = resolveTestDatabaseUrl();
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.mts"],
    env: { DATABASE_URL: testDatabaseUrl },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
