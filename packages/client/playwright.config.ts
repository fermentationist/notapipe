import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ignoreHTTPSErrors: true },
    },
  ],
  webServer: [
    {
      command: "pnpm run dev",
      url: "https://localhost:5173",
      reuseExistingServer: true,
      ignoreHTTPSErrors: true,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "MAX_JOINS_PER_WINDOW=1000 pnpm --filter @notapipe/signalling run start",
      url: "http://localhost:3001",
      reuseExistingServer: true,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
