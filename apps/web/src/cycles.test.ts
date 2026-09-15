import { test, expect } from "vitest";
import { bucketByCycle, NO_CYCLE_LABEL, resolveBucket, snapBand } from "./cycles.js";
import type { CycleDef } from "./api.js";

function cycle(name: string, start: string, end: string | null = null): CycleDef {
  return { name, start, end };
}

function row(date: string, values: Record<string, number> = {}): Record<string, number | string> {
  return { date, ...values };
}

// ---- bucketByCycle ----

test("bucketByCycle: sums each cycle's cost into its own bucket", () => {
  const cycles = [cycle("Discovery", "2026-06-01", "2026-06-03"), cycle("Build", "2026-06-04")];
  const daily = [row("2026-06-01", { cost: 10 }), row("2026-06-02", { cost: 20 }), row("2026-06-04", { cost: 5 })];
  const out = bucketByCycle(daily, cycles);
  const byLabel = new Map(out.map((r) => [r.date, r]));
  expect(byLabel.get("Discovery")!.cost).toBe(30);
  expect(byLabel.get("Build")!.cost).toBe(5);
});

test("bucketByCycle: a leading gap before the first cycle gets its own numbered bucket", () => {
  const cycles = [cycle("Build", "2026-06-10")];
  const daily = [row("2026-06-01", { cost: 5 }), row("2026-06-10", { cost: 10 })];
  const out = bucketByCycle(daily, cycles);
  expect(out.map((r) => r.date)).toEqual([`(${NO_CYCLE_LABEL} 1)`, "Build"]);
});

test("bucketByCycle: an interior gap between two cycles gets its own bucket, not merged into the trailing one", () => {
  const cycles = [cycle("A", "2026-06-01", "2026-06-02"), cycle("B", "2026-06-10", "2026-06-11")];
  const daily = [
    row("2026-06-01", { cost: 1 }),
    row("2026-06-05", { cost: 2 }), // in the gap between A and B
    row("2026-06-10", { cost: 3 }),
  ];
  const out = bucketByCycle(daily, cycles);
  expect(out.map((r) => r.date)).toEqual(["A", `(${NO_CYCLE_LABEL} 1)`, "B"]);
});

test("bucketByCycle: a trailing gap after the last (closed) cycle gets its own bucket", () => {
  const cycles = [cycle("A", "2026-06-01", "2026-06-02")];
  const daily = [row("2026-06-01", { cost: 1 }), row("2026-06-05", { cost: 2 })];
  const out = bucketByCycle(daily, cycles);
  expect(out.map((r) => r.date)).toEqual(["A", `(${NO_CYCLE_LABEL} 1)`]);
});

test("bucketByCycle: an empty bucket (no rows fall in it) is dropped, not emitted as a zero row", () => {
  const cycles = [cycle("A", "2026-06-01", "2026-06-05"), cycle("B", "2026-06-06")];
  const daily = [row("2026-06-01", { cost: 1 })]; // nothing in B's window
  const out = bucketByCycle(daily, cycles);
  expect(out.map((r) => r.date)).toEqual(["A"]);
});

test("bucketByCycle: group sums never overwrite the bucket's own metadata, even when a group is literally named 'days'/'start'/'end' (#30 item 5)", () => {
  const cycles = [cycle("A", "2026-06-01", "2026-06-02")];
  const daily = [row("2026-06-01", { days: 999, start: 999, end: 999, cost: 5 })];
  const out = bucketByCycle(daily, cycles);
  const a = out[0]!;
  expect(a.days).toBe(2); // the real calendar span (2 inclusive days), not the group sum's 999
  expect(a.start).toBe("2026-06-01");
  expect(a.end).toBe("2026-06-02");
  expect(a.cost).toBe(5);
});

// ---- snapBand ----

test("snapBand: snaps a cycle's start/end onto the nearest rendered labels", () => {
  const c = cycle("A", "2026-06-01", "2026-06-05");
  const labels = ["2026-06-01", "2026-06-08", "2026-06-15"]; // weekly buckets
  expect(snapBand(c, labels, "week")).toEqual({ x1: "2026-06-01", x2: "2026-06-01" });
});

test("snapBand: an open-ended cycle snaps its end to the chart's last label", () => {
  const c = cycle("A", "2026-06-01", null);
  const labels = ["2026-06-01", "2026-06-08", "2026-06-15"];
  expect(snapBand(c, labels, "week")).toEqual({ x1: "2026-06-01", x2: "2026-06-15" });
});

test("snapBand: a cycle entirely outside the chart's rendered range returns null", () => {
  const c = cycle("A", "2027-01-01", "2027-01-05");
  const labels = ["2026-06-01", "2026-06-08"];
  expect(snapBand(c, labels, "week")).toBe(null);
});

test("snapBand: no rendered labels at all returns null", () => {
  expect(snapBand(cycle("A", "2026-06-01"), [], "week")).toBe(null);
});

// ---- resolveBucket (#29: the bucket/URL desync bug) ----

test("resolveBucket: 'cycle' resolves to cycle only when cycles are actually available", () => {
  expect(resolveBucket("cycle", true)).toBe("cycle");
  expect(resolveBucket("cycle", false)).toBe("week"); // falls back — see GroupsView for how the control avoids misrepresenting this
});

test("resolveBucket: 'day'/'month' pass through regardless of cycleAvailable", () => {
  expect(resolveBucket("day", false)).toBe("day");
  expect(resolveBucket("month", true)).toBe("month");
});

test("resolveBucket: anything else (including 'week' itself, or garbage) defaults to week", () => {
  expect(resolveBucket("week", true)).toBe("week");
  expect(resolveBucket("bogus", true)).toBe("week");
  expect(resolveBucket("", false)).toBe("week");
});
