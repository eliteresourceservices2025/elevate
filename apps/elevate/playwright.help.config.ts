import { defineConfig, devices } from "@playwright/test";

// Takes the screenshots for the Help center guides (see docs/modules/help-center.md). Run it with `pnpm help:shots`.
// It needs the local Supabase with migrations and the seed (`supabase start`, `pnpm db:migrate`, `pnpm db:seed`) and only ever
// talks to that local database. If your own dev server already runs, point at it: E2E_BASE_URL=http://localhost:3000 pnpm help:shots
const externalUrl = process.env.E2E_BASE_URL;
const port = 3100;
const baseURL = externalUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/help",
  testMatch: /capture\.spec\.ts$/,
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  // A step that cannot find its target should fail the one picture quickly, not stall the whole run.
  use: { baseURL, ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, colorScheme: "light", deviceScaleFactor: 1, actionTimeout: 20_000, navigationTimeout: 60_000 },
  webServer: externalUrl
    ? undefined
    : { command: `pnpm exec next dev --port ${port}`, url: `${baseURL}/login`, reuseExistingServer: true, timeout: 120_000 },
});
