import path from "node:path";
import { defineConfig } from "vitest/config";

// Database-backed tests. They need a Postgres server the test user may create databases on:
//   TEST_DB_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres  (local Supabase)
// Each run drops and recreates a throwaway database named elevate_test, so nothing real is touched.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
