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
      // map.ts, join.ts, export.ts; Phase 2 (#34) adds aggregate.ts; Phase 3 (#35)
      // adds apps/server's app.ts/state.ts; #25 adds client.ts/sync.ts (previously
      // excluded from coverage as untestable network I/O — the injectable
      // fetch/sleep added for retry/backoff/timeout testing is what changed that).
      // Later phases raise thresholds for the rest of packages/core, then apps/web,
      // apps/cli in turn.
      thresholds: {
        "packages/core/src/map.ts": { lines: 70, branches: 65 },
        "packages/core/src/join.ts": { lines: 70, branches: 65 },
        "packages/core/src/export.ts": { lines: 70, branches: 65 },
        "packages/core/src/aggregate.ts": { lines: 80, branches: 75 },
        "packages/core/src/client.ts": { lines: 75, branches: 70 },
        "packages/core/src/sync.ts": { lines: 90, branches: 90 },
        "apps/server/src/app.ts": { lines: 55, branches: 45 },
        "apps/server/src/state.ts": { lines: 55, branches: 45 },
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
