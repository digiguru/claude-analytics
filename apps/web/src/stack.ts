// Pivot for the Groups page's "Cost over time" chart: turn the server's daily
// group×date rows into one row per time bucket with a cost column per group
// key, capping the stack at the top N keys by total cost plus an "Other"
// catch-all. Extracted from GroupsView's useStackedSeries (#29) so the pivot
// itself is testable with no chart/component involved.
import { bucketByCycle, type ChartBucket } from "./cycles.js";
import { bucketSeries } from "./series.js";
import type { GroupDayRow, ProjectCycles } from "./api.js";

export type { ChartBucket };

/** Group key reserved for days with no active project/team/client membership —
 *  must match core's UNASSIGNED_KEY (packages/core/src/projects.ts). Always
 *  rendered last, in its own fixed colour, never folded into "Other". */
export const UNASSIGNED_KEY = "Unassigned";
/** Catch-all key for every group past the top N by total cost. */
export const OTHER_KEY = "Other";

export interface StackedSeries {
  rows: Record<string, number | string | null>[];
  keys: string[];
}

/**
 * Pivot the daily group×date rows into one row per bucket with a cost column
 * per key, capping the stack at the top `maxKeys` keys (by total cost) plus
 * an "Other" catch-all. `Unassigned` always renders, last, regardless of
 * rank. Buckets by day/week/month, or — when scoped to one project with
 * cycles — by cycle.
 */
export function stackRows(
  timeseries: GroupDayRow[],
  keys: string[],
  bucket: ChartBucket,
  cycles: ProjectCycles["cycles"],
  maxKeys = 8,
): StackedSeries {
  if (timeseries.length === 0) return { rows: [], keys: [] };

  const rankedKeys = keys.filter((k) => k !== UNASSIGNED_KEY);
  const hasUnassigned = keys.includes(UNASSIGNED_KEY);
  const top = new Set(rankedKeys.slice(0, maxKeys));
  const hasOther = rankedKeys.length > top.size;

  const byDate = new Map<string, Record<string, number | string>>();
  for (const row of timeseries) {
    let acc = byDate.get(row.date);
    if (!acc) byDate.set(row.date, (acc = { date: row.date }));
    const label = row.key === UNASSIGNED_KEY || top.has(row.key) ? row.key : OTHER_KEY;
    // Accumulate in cents (integers) — converting to float dollars before
    // summing drifts from the server's integer-cent totals (#21). Divide
    // only at display time, via `usd`.
    acc[label] = (Number(acc[label]) || 0) + row.costCents;
  }
  const daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const bucketed = bucket === "cycle" ? bucketByCycle(daily, cycles) : bucketSeries(daily, bucket, {});

  const outKeys = [
    ...rankedKeys.filter((k) => top.has(k)),
    ...(hasOther ? [OTHER_KEY] : []),
    ...(hasUnassigned ? [UNASSIGNED_KEY] : []),
  ];
  return { rows: bucketed, keys: outKeys };
}
