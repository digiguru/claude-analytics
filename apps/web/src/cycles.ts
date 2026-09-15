// Cycle-aware chart helpers: bucketing a project's cost-over-time series by its
// declared cycles instead of day/week/month, and mapping cycles onto a chart's
// rendered category buckets for annotation (bands/lanes). Kept separate from
// series.ts, whose trend/forecast maths (FORECAST_PERIODS, fullPeriodDays) has
// no meaning for irregular, hand-declared cycle windows.
import { bucketLabel, type Granularity } from "./series.js";
import type { CycleDef } from "./api.js";

export type ChartBucket = Granularity | "cycle";

/** Bucket label for time inside a project but outside every one of its cycles. */
export const NO_CYCLE_LABEL = "(no cycle)";

type Row = Record<string, number | string>;

/**
 * Collapse daily rows into one row per cycle (chronological, `cycles` order),
 * plus a single trailing "(no cycle)" bucket for any days that fell outside
 * every cycle — emitted only when it actually has cost, so the bars still sum
 * to the project's true total without an always-there empty bar. Mirrors
 * bucketSeries' "sum every numeric key" contract; `date` on each row is the
 * cycle's display name (so the existing `<XAxis dataKey="date">` needs no change).
 */
export function bucketByCycle(daily: Row[], cycles: CycleDef[]): Row[] {
  const buckets = cycles.map((c) => ({ label: c.name, sums: {} as Record<string, number>, n: 0 }));
  const noCycle = { label: NO_CYCLE_LABEL, sums: {} as Record<string, number>, n: 0 };

  for (const row of daily) {
    const date = String(row.date);
    const bucket = buckets.find((_, i) => {
      const c = cycles[i]!;
      return c.start <= date && (c.end === null || date <= c.end);
    });
    const target = bucket ?? noCycle;
    target.n += 1;
    for (const [k, v] of Object.entries(row)) {
      if (k === "date" || typeof v !== "number") continue;
      target.sums[k] = (target.sums[k] ?? 0) + v;
    }
  }

  const out: Row[] = [];
  for (const b of buckets) if (b.n > 0) out.push({ date: b.label, ...b.sums });
  if (noCycle.n > 0) out.push({ date: noCycle.label, ...noCycle.sums });
  return out;
}

/**
 * Snap a cycle's [start, end] onto a chart's rendered category labels (which
 * may be day/week/month buckets, not raw dates) — required because a
 * ReferenceArea on a category axis only renders when x1/x2 string-match an
 * actual data point. Returns null when the cycle covers no rendered bucket
 * (e.g. entirely outside the chart's date range).
 */
export function snapBand(
  cycle: CycleDef,
  labels: string[],
  granularity: Granularity,
): { x1: string; x2: string } | null {
  if (labels.length === 0) return null;
  const startLabel = bucketLabel(cycle.start, granularity);
  const endLabel = cycle.end ? bucketLabel(cycle.end, granularity) : labels[labels.length - 1]!;

  let x1: string | null = null;
  for (const l of labels) {
    if (l >= startLabel) {
      x1 = l;
      break;
    }
  }
  let x2: string | null = null;
  for (let i = labels.length - 1; i >= 0; i--) {
    if (labels[i]! <= endLabel) {
      x2 = labels[i]!;
      break;
    }
  }
  if (x1 === null || x2 === null || x1 > x2) return null;
  return { x1, x2 };
}
