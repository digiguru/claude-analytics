import { test, expect } from "vitest";
import { groupRow, groupRowWithPrimary } from "./__tests__/groupRow.js";
import { buildGroupBreakdown, TOP_KEY, TOTAL_KEY } from "./groupBreakdown.js";
import { OTHER_KEY, UNASSIGNED_KEY } from "./stack.js";

const g = (key: string, costCents: number) => groupRow({ key, costCents });
const s = (primaryKey: string, key: string, costCents: number) => groupRowWithPrimary({ key, primaryKey, costCents });

test("buildGroupBreakdown: no secondary rows -> nothing to stack", () => {
  expect(buildGroupBreakdown([g("Alpha", 100)], [], "costCents")).toEqual({ rows: [], keys: [] });
});

test("buildGroupBreakdown: one row per group, in the order given, with a column per secondary key", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 300), g("Beta", 100)],
    [s("Alpha", "Team A", 200), s("Alpha", "Team B", 100), s("Beta", "Team A", 100)],
    "costCents",
  );
  expect(out.keys).toEqual(["Team A", "Team B"]); // ranked by total across all groups
  expect(out.rows).toEqual([
    { name: "Alpha", "Team A": 200, "Team B": 100, [TOTAL_KEY]: 300, [TOP_KEY]: "Team B" },
    { name: "Beta", "Team A": 100, [TOTAL_KEY]: 100, [TOP_KEY]: "Team A" },
  ]);
});

// The group order is the page's metric/sort choice — the pivot must never
// re-sort it, however the secondary totals fall out.
test("buildGroupBreakdown: preserves the caller's group order", () => {
  const out = buildGroupBreakdown(
    [g("Beta", 100), g("Alpha", 300)],
    [s("Alpha", "T", 300), s("Beta", "T", 100)],
    "costCents",
  );
  expect(out.rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
});

test("buildGroupBreakdown: keys past maxKeys fold into Other, which stacks after the ranked keys", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 60)],
    [s("Alpha", "a", 30), s("Alpha", "b", 20), s("Alpha", "c", 7), s("Alpha", "d", 3)],
    "costCents",
    2,
  );
  expect(out.keys).toEqual(["a", "b", OTHER_KEY]);
  expect(out.rows[0]).toEqual({ name: "Alpha", a: 30, b: 20, [OTHER_KEY]: 10, [TOTAL_KEY]: 60, [TOP_KEY]: OTHER_KEY });
});

test("buildGroupBreakdown: Unassigned is never folded into Other and always stacks last", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 100)],
    [s("Alpha", "a", 50), s("Alpha", "b", 40), s("Alpha", UNASSIGNED_KEY, 1), s("Alpha", "c", 9)],
    "costCents",
    2,
  );
  expect(out.keys).toEqual(["a", "b", OTHER_KEY, UNASSIGNED_KEY]);
  expect(out.rows[0]![UNASSIGNED_KEY]).toBe(1);
  expect(out.rows[0]![OTHER_KEY]).toBe(9);
});

test("buildGroupBreakdown: secondary rows for a group that isn't on the chart are dropped", () => {
  const out = buildGroupBreakdown([g("Alpha", 100)], [s("Alpha", "T", 100), s("Gone", "T", 999)], "costCents");
  expect(out.rows).toEqual([{ name: "Alpha", T: 100, [TOTAL_KEY]: 100, [TOP_KEY]: "T" }]);
});

test("buildGroupBreakdown: stacks whichever metric is asked for", () => {
  const out = buildGroupBreakdown(
    [groupRow({ key: "Alpha", ccSessions: 7 })],
    [groupRowWithPrimary({ key: "T", primaryKey: "Alpha", ccSessions: 7, costCents: 999 })],
    "ccSessions",
  );
  expect(out.rows[0]).toEqual({ name: "Alpha", T: 7, [TOTAL_KEY]: 7, [TOP_KEY]: "T" });
});

// For an additive metric the drill-down is a true partition of the group (see
// core's combineKeyers), so the stack height must match the group's own figure.
test("buildGroupBreakdown: an additive metric's stack total equals the group's total", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 300)],
    [s("Alpha", "Team A", 200), s("Alpha", "Team B", 100)],
    "costCents",
  );
  expect(out.rows[0]![TOTAL_KEY]).toBe(300);
});

// The chart hangs each group's total label off its topmost *drawn* segment:
// recharts drops zero-valued entries, so naming the last key outright would
// lose the label for every group that has nothing in it.
test("buildGroupBreakdown: the topmost key skips the keys this group has nothing in", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 300), g("Beta", 100)],
    [s("Alpha", "Team A", 200), s("Alpha", "Team B", 100), s("Beta", "Team A", 100)],
    "costCents",
  );
  expect(out.rows[0]![TOP_KEY]).toBe("Team B"); // Alpha reaches the last key
  expect(out.rows[1]![TOP_KEY]).toBe("Team A"); // Beta has no Team B at all
});

test("buildGroupBreakdown: a group with no breakdown rows at all gets no topmost key", () => {
  const out = buildGroupBreakdown([g("Alpha", 100), g("Empty", 0)], [s("Alpha", "T", 100)], "costCents");
  expect(out.rows[1]).toEqual({ name: "Empty", [TOTAL_KEY]: 0, [TOP_KEY]: "" });
});

// Money arrives from the API as fractional cents and has produced $NaN before
// (#21); a non-finite metric value must fall back to 0 rather than poisoning
// the key ranking and every total downstream of it.
test("buildGroupBreakdown: a non-numeric metric value counts as 0, not NaN", () => {
  const out = buildGroupBreakdown(
    [g("Alpha", 100)],
    [s("Alpha", "Team A", Number.NaN), s("Alpha", "Team B", 100)],
    "costCents",
  );
  expect(out.keys).toEqual(["Team B", "Team A"]); // NaN ranks last, not first
  expect(out.rows[0]).toEqual({
    name: "Alpha",
    "Team A": 0,
    "Team B": 100,
    [TOTAL_KEY]: 100,
    [TOP_KEY]: "Team B",
  });
});
