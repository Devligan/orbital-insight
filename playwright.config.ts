import { defineConfig, devices } from "@playwright/test";

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

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
    // Deployed previews behind Vercel Deployment Protection (post-deploy.yml).
    ...(bypassSecret
      ? { extraHTTPHeaders: { "x-vercel-protection-bypass": bypassSecret, "x-vercel-set-bypass-cookie": "true" } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // CI runners have no GPU: SwiftShader gives Chromium a software WebGL
        // so the globe journeys exercise Cesium instead of the 2D fallback.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
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
