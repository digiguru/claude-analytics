import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "lcov"],
      // Phased in per sub-issue of the test coverage epic (#31): only the files a
      // given phase actually added tests for are gated here. Phase 1 (#33) covers
      // map.ts, join.ts, export.ts; later phases raise thresholds for more of
      // packages/core, then apps/server, apps/web, apps/cli in turn.
      thresholds: {
        "packages/core/src/map.ts": { lines: 70, branches: 65 },
        "packages/core/src/join.ts": { lines: 70, branches: 65 },
        "packages/core/src/export.ts": { lines: 70, branches: 65 },
      },
    },
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          pool: "forks",
          include: ["packages/core/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          pool: "forks",
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "cli",
          environment: "node",
          include: ["apps/cli/src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
