import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node's built-in .env loader (no dotenv dependency needed) — DATABASE_URL
// etc. come from .env for local runs; CI sets them directly instead (see
// .github/workflows/ci.yml).
try {
  process.loadEnvFile();
} catch {
  // no .env present — fine in CI, where env vars are already set
}

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
