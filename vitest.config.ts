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
        "apps/web/src/__tests__/**",
        "apps/web/src/main.tsx",
        "apps/web/src/testSetup.ts",
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
      // the chart-level "Breakdown by" adds groupBreakdown.ts, stack.ts's
      // sibling pivot, gated to match it;
      // Phase 5 (#37) adds apps/cli's command modules and format helpers, after
      // moving all command logic out of index.ts's `.action()` bodies (index.ts
      // itself stays ungated commander wiring, like apps/server's index.ts).
      // Phase 6 (#38) adds component tests for App.tsx and the components
      // listed in #38's issue text (SortableTable, FilterMenu, ControlBar,
      // SeriesControls, CycleRail, NestedGroupsTable) plus several small
      // presentational ones it was cheap to fully cover alongside them
      // (GroupsTableSection, KeyBreakdownRows, StackedCostTooltip,
      // GroupTotalsChart, GroupsControls). Left untested by design, per #38's
      // own scope: the recharts-heavy views (GroupsView, OverviewView,
      // MembersView, CostOverTimeChart, VariableWidthBars) — assert the
      // container renders and the right data reached it, not chart SVG
      // geometry; that's exactly what e2e/app.spec.ts (Playwright) is for.
      // Later phases raise thresholds for the rest of packages/core.
      //
      // apps/web's steady-state target (60% lines / 50% branches overall) is
      // met as of this phase (60.6%/50.5% on a full `test:coverage` run) —
      // not itself machine-enforced here (thresholds below are per-file), but
      // verified and worth keeping true going forward.
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
        "apps/web/src/groupBreakdown.ts": { lines: 95, branches: 90 },
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
        "apps/web/src/App.tsx": { lines: 70, branches: 60 },
        "apps/web/src/components/ControlBar.tsx": { lines: 60, branches: 55 },
        "apps/web/src/components/SortableTable.tsx": { lines: 80, branches: 75 },
        "apps/web/src/components/FilterMenu.tsx": { lines: 80, branches: 75 },
        "apps/web/src/components/CycleRail.tsx": { lines: 95, branches: 80 },
        "apps/web/src/components/NestedGroupsTable.tsx": { lines: 95, branches: 80 },
        "apps/web/src/components/GroupsTableSection.tsx": { lines: 95, branches: 80 },
        "apps/web/src/components/KeyBreakdownRows.tsx": { lines: 95, branches: 80 },
        "apps/web/src/components/StackedCostTooltip.tsx": { lines: 95, branches: 90 },
        "apps/web/src/components/SeriesControls.tsx": { lines: 95, branches: 95 },
        "apps/web/src/components/GroupsControls.tsx": { lines: 95, branches: 95 },
        "apps/web/src/components/GroupTotalsChart.tsx": { lines: 95, branches: 45 },
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
          // Reuses one jsdom environment per worker (still one module registry
          // per test file, so isolation between files is unaffected) instead of
          // spinning up a fresh jsdom per file — jsdom creation was ~65% of
          // this project's total test time.
          pool: "vmThreads",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          setupFiles: ["./apps/web/src/testSetup.ts"],
        },
      },
    ],
  },
});
