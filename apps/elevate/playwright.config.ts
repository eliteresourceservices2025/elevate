import { defineConfig, devices } from "@playwright/test";

// Local run: `supabase start`, `pnpm db:migrate`, then `pnpm test:e2e`.
// If your own dev server is already running, point at it: E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
const externalUrl = process.env.E2E_BASE_URL;
const port = 3100;
const baseURL = externalUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Several tests share one development server that compiles pages on demand, so allow for slow moments.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalUrl
    ? undefined
    : {
        command: `pnpm exec next dev --port ${port}`,
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
