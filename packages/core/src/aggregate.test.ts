import { test, expect } from "vitest";
import {
  aggregateByKeyer,
  combineKeyers,
  csvKeyer,
  cycleKeyer,
  memberKeyer,
  splitCombinedKey,
  timelineKeyer,
} from "./aggregate.js";
import { cyclesFor, NO_CYCLE_KEY, parseProjectsYaml } from "./projects.js";
import type { UserDayRow, UserProductRow } from "./types.js";

function product(email: string, date: string, costCents: number): UserProductRow {
  return {
    date,
    userId: email,
    email,
    product: "chat",
    costCents,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    requests: 1,
  };
}

const emptyDays: UserDayRow[] = [];
const SEP = "\u0000";

test("splitCombinedKey round-trips a plain combineKeyers key", () => {
  expect(splitCombinedKey(`Team A${SEP}ann@x.com`)).toEqual({ primary: "Team A", secondary: "ann@x.com" });
});

test("splitCombinedKey handles a key with no separator (shouldn't happen, but stays safe)", () => {
  expect(splitCombinedKey("just-primary")).toEqual({ primary: "just-primary", secondary: "" });
});

test("combineKeyers: two whole-weight keyers (CSV x Member) — secondary breakdown sums to the primary total", () => {
  const attrs = new Map([
    ["ann@x.com", { Team: "Alpha" }],
    ["bob@x.com", { Team: "Alpha" }],
    ["cas@x.com", { Team: "Beta" }],
  ]);
  const rows: UserProductRow[] = [
    product("ann@x.com", "2026-06-01", 100),
    product("bob@x.com", "2026-06-01", 50),
    product("cas@x.com", "2026-06-01", 30),
  ];

  const primary = csvKeyer(attrs, "Team");
  const primaryOnly = aggregateByKeyer(rows, emptyDays, primary);
  const alphaTotal = primaryOnly.find((g) => g.key === "Alpha")!.costCents;
  expect(alphaTotal).toBe(150);

  const combined = combineKeyers(primary, memberKeyer());
  const nested = aggregateByKeyer(rows, emptyDays, combined);
  const alphaMembers = nested
    .map((g) => ({ ...splitCombinedKey(g.key), costCents: g.costCents }))
    .filter((g) => g.primary === "Alpha");
  expect(alphaMembers.length).toBe(2);
  const sum = alphaMembers.reduce((s, g) => s + g.costCents, 0);
  expect(sum).toBe(alphaTotal); // secondary breakdown reconciles with the primary total
});

test("combineKeyers: a concurrently-split person's cost is distributed correctly across BOTH dimensions", () => {
  // ann is 60/40 across two projects on the same day — the Cartesian product
  // must preserve that split when grouping by @project with a member secondary.
  const yaml = `
projects:
  - name: Acme
    members:
      - email: ann@x.com
        start: 2026-06-01
        allocation: 0.6
  - name: Globex
    members:
      - email: ann@x.com
        start: 2026-06-01
        allocation: 0.4
`;
  const { index } = parseProjectsYaml(yaml);
  const rows: UserProductRow[] = [product("ann@x.com", "2026-06-01", 100)];

  const combined = combineKeyers(timelineKeyer(index, "project"), memberKeyer());
  const nested = aggregateByKeyer(rows, emptyDays, combined);
  const byKey = new Map(nested.map((g) => [g.key, g.costCents]));
  expect(byKey.get(`Acme${SEP}ann@x.com`)).toBe(60);
  expect(byKey.get(`Globex${SEP}ann@x.com`)).toBe(40);
  expect(nested.length).toBe(2);
});

test("cycleKeyer: groups a project's cost by which of its own cycles each day falls in", () => {
  const yaml = `
projects:
  - name: Acme
    cycles:
      - name: Discovery
        start: 2026-06-01
      - name: Build
        start: 2026-06-04
    members:
      - email: ann@x.com
        start: 2026-06-01
`;
  const { cycles } = parseProjectsYaml(yaml);
  const rows: UserProductRow[] = [
    product("ann@x.com", "2026-06-01", 100), // Discovery
    product("ann@x.com", "2026-06-03", 50), // Discovery (derived end, day before Build)
    product("ann@x.com", "2026-06-04", 30), // Build
    product("ann@x.com", "2026-05-20", 10), // before any cycle -> NO_CYCLE_KEY
  ];

  const keyer = cycleKeyer(cyclesFor(cycles, "Acme"));
  const groups = aggregateByKeyer(rows, emptyDays, keyer);
  const byKey = new Map(groups.map((g) => [g.key, g.costCents]));
  expect(byKey.get("Discovery")).toBe(150);
  expect(byKey.get("Build")).toBe(30);
  expect(byKey.get(NO_CYCLE_KEY)).toBe(10);
});
