import { defineConfig, devices } from "@playwright/test";

// Browser-level smoke test (#38) — the one thing no amount of jsdom/component
// testing can verify: that the app actually mounts and renders real chart
// SVG output in a real browser, proving the recharts 2→3 migration (#14)
// didn't silently break. `npm run build` must run first so web/dist exists
// for the seed server to serve; see e2e/seed-server.ts for how it boots.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx e2e/seed-server.ts",
    url: "http://127.0.0.1:4173/api/status",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
