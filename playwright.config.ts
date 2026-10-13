import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against the production build (`next build && next start`)
 * so the flow under test matches deployment. Requires the build to succeed.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3777",
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next start -p 3777",
        url: "http://localhost:3777",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
