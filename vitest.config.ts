import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      all: true,
      // Explicit include so `all: true` actually enumerates files no test
      // imports at all (e.g. apps/web's not-yet-tested components) — v8's
      // "all" mode otherwise only instruments files reachable from an
      // executed test's import graph, which understates exactly the
      // "pulled down by not-yet-tested components" case #36's apps/web
      // target is about. Per-file numbers for ungated files can look lower
      // here than a single-workspace run would show (more of the codebase is
      // now in the shared denominator) — that's expected and does not affect
      // the gated files below, all of which still clear their thresholds.
      include: [
        "packages/core/src/**/*.ts",
        "apps/server/src/**/*.ts",
        "apps/cli/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "packages/core/src/__fixtures__/**",
        "apps/server/src/__tests__/**",
        "apps/cli/src/__tests__/**",
        "apps/web/src/main.tsx",
      ],
      reporter: ["text", "lcov"],
      // Phased in per sub-issue of the test coverage epic (#31): only the files a
      // given phase actually added tests for are gated here. Phase 1 (#33) covers
      // map.ts, join.ts, export.ts; Phase 2 (#34) adds aggregate.ts; Phase 3 (#35)
      // adds apps/server's app.ts/state.ts; #25 adds client.ts/sync.ts (previously
      // excluded from coverage as untestable network I/O — the injectable
      // fetch/sleep added for retry/backoff/timeout testing is what changed that);
      // Phase 4 (#36) adds apps/web's pure-logic modules; #29 (GroupsView
      // decomposition) adds the further extractions that came out of it
      // (stack.ts, quickFilter.ts, groupColumns.ts, cycles.ts's resolveBucket);
      // Phase 5 (#37) adds apps/cli's command modules and format helpers, after
      // moving all command logic out of index.ts's `.action()` bodies (index.ts
      // itself stays ungated commander wiring, like apps/server's index.ts).
      // Later phases raise thresholds for the rest of packages/core and
      // apps/web's components (#38).
      //
      // Note on #36's stated apps/web target (45% lines / 35% branches overall):
      // that's arithmetically unreachable while apps/web/src/components/** stays
      // untested, as this phase's own scope requires (component rendering is
      // Phase 6, #38) — components are ~55% of apps/web's total line count, all
      // at 0%. Gating the specific files this phase actually tests, at the levels
      // they actually achieve, is the honest version of that intent; the
      // workspace-wide number will clear 45%/35% once #38 lands.
      thresholds: {
        "packages/core/src/map.ts": { lines: 70, branches: 65 },
        "packages/core/src/join.ts": { lines: 70, branches: 65 },
        "packages/core/src/export.ts": { lines: 70, branches: 65 },
        "packages/core/src/aggregate.ts": { lines: 80, branches: 75 },
        "packages/core/src/client.ts": { lines: 75, branches: 70 },
        "packages/core/src/sync.ts": { lines: 90, branches: 90 },
        "apps/server/src/app.ts": { lines: 55, branches: 45 },
        "apps/server/src/state.ts": { lines: 55, branches: 45 },
        "apps/web/src/dragSelection.ts": { lines: 90, branches: 85 },
        "apps/web/src/filters.ts": { lines: 75, branches: 70 },
        "apps/web/src/series.ts": { lines: 85, branches: 60 },
        "apps/web/src/cycles.ts": { lines: 90, branches: 85 },
        "apps/web/src/charts.tsx": { lines: 80, branches: 70 },
        "apps/web/src/stack.ts": { lines: 95, branches: 90 },
        "apps/web/src/quickFilter.ts": { lines: 95, branches: 90 },
        "apps/web/src/groupColumns.ts": { lines: 90, branches: 80 },
        "apps/cli/src/format.ts": { lines: 90, branches: 90 },
        "apps/cli/src/load.ts": { lines: 90, branches: 70 },
        "apps/cli/src/commands/columns.ts": { lines: 95, branches: 85 },
        "apps/cli/src/commands/export.ts": { lines: 95, branches: 70 },
        "apps/cli/src/commands/group.ts": { lines: 95, branches: 60 },
        "apps/cli/src/commands/groupBy.ts": { lines: 75, branches: 70 },
        "apps/cli/src/commands/member.ts": { lines: 95, branches: 70 },
        "apps/cli/src/commands/overview.ts": { lines: 95, branches: 90 },
        "apps/cli/src/commands/projects.ts": { lines: 85, branches: 60 },
        "apps/cli/src/commands/sync.ts": { lines: 80, branches: 70 },
        "apps/cli/src/commands/top.ts": { lines: 95, branches: 85 },
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
