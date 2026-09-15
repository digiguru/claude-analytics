import { test, expect } from "vitest";
import { OTHER_KEY, stackRows, UNASSIGNED_KEY } from "./stack.js";
import type { GroupDayRow } from "./api.js";

function row(date: string, key: string, costCents: number): GroupDayRow {
  return { date, key, costCents, totalTokens: 0 };
}

test("stackRows: empty timeseries returns empty rows and keys", () => {
  expect(stackRows([], [], "day", [])).toEqual({ rows: [], keys: [] });
});

test("stackRows: pivots one column per key, cost in cents", () => {
  const rows = [row("2026-06-01", "Acme", 1000), row("2026-06-01", "Globex", 500)];
  const out = stackRows(rows, ["Acme", "Globex"], "day", []);
  expect(out.rows).toEqual([{ date: "2026-06-01", Acme: 1000, Globex: 500 }]);
  expect(out.keys).toEqual(["Acme", "Globex"]);
});

test("stackRows: keys beyond maxKeys are folded into Other, ranked by total cost", () => {
  const rows = [row("2026-06-01", "A", 300), row("2026-06-01", "B", 200), row("2026-06-01", "C", 100)];
  const out = stackRows(rows, ["A", "B", "C"], "day", [], 2);
  expect(out.keys).toEqual(["A", "B", OTHER_KEY]);
  expect(out.rows[0]![OTHER_KEY]).toBe(100); // C's 100 cents, kept as cents
});

test("stackRows: Unassigned is never folded into Other and always sorts last", () => {
  const rows = [
    row("2026-06-01", "A", 100),
    row("2026-06-01", "B", 100),
    row("2026-06-01", "C", 100),
    row("2026-06-01", UNASSIGNED_KEY, 50),
  ];
  const out = stackRows(rows, ["A", "B", "C", UNASSIGNED_KEY], "day", [], 2);
  expect(out.keys).toEqual(["A", "B", OTHER_KEY, UNASSIGNED_KEY]);
});

test("stackRows: with maxKeys covering every key, there's no Other bucket", () => {
  const rows = [row("2026-06-01", "A", 100), row("2026-06-01", "B", 100)];
  const out = stackRows(rows, ["A", "B"], "day", [], 8);
  expect(out.keys).toEqual(["A", "B"]);
});

test("stackRows: buckets by week when requested, summing across days", () => {
  const rows = [row("2026-06-01", "A", 100), row("2026-06-02", "A", 200)]; // same ISO week
  const out = stackRows(rows, ["A"], "week", []);
  expect(out.rows).toHaveLength(1);
  expect(out.rows[0]!.A).toBe(300); // 100+200 cents
});

test("stackRows: bucket 'cycle' delegates to bucketByCycle", () => {
  const rows = [row("2026-06-01", "A", 100)];
  const cycles = [{ name: "Discovery", start: "2026-06-01", end: null }];
  const out = stackRows(rows, ["A"], "cycle", cycles);
  expect(out.rows).toEqual([expect.objectContaining({ date: "Discovery", A: 100 })]);
});
