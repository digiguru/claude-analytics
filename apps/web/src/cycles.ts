// Cycle-aware chart helpers: bucketing a project's cost-over-time series by its
// declared cycles instead of day/week/month, and mapping cycles onto a chart's
// rendered category buckets for annotation (bands/lanes). Kept separate from
// series.ts, whose trend/forecast maths (FORECAST_PERIODS, fullPeriodDays) has
// no meaning for irregular, hand-declared cycle windows.
import { bucketLabel, type Granularity } from "./series.js";
import type { CycleDef } from "./api.js";

export type ChartBucket = Granularity | "cycle";

/** Label prefix for time inside a project but outside every one of its cycles —
 *  each gap gets its own numbered label (e.g. "(no cycle 1)"), never a shared one. */
export const NO_CYCLE_LABEL = "no cycle";

/**
 * Resolve the "Cost over time" chart's actual granularity from the raw
 * `?granularity=` URL value: "cycle" only when cycles are actually available
 * for whatever's in scope, "day"/"month" as given, else "week". Extracted
 * from GroupsView (#29) so the URL/state desync it was implicated in is
 * pinned by a test: requesting "cycle" before cycleAvailable becomes true
 * resolves to "week" here (a real, correct fallback — the caller is
 * responsible for not misrepresenting `bucketRaw` itself as changed; see
 * GroupsView's granularity control, which reflects `bucketRaw` rather than
 * this resolved value so the button doesn't visibly flip Week→Cycle).
 */
export function resolveBucket(bucketRaw: string, cycleAvailable: boolean): ChartBucket {
  if (bucketRaw === "cycle") return cycleAvailable ? "cycle" : "week";
  if (bucketRaw === "day" || bucketRaw === "month") return bucketRaw;
  return "week";
}

type Row = Record<string, number | string>;

/** Calendar day arithmetic on "YYYY-MM-DD" strings (UTC, so no DST surprises). */
function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function daysInclusive(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/** One bucket-to-be: a label, its calendar window (inclusive — used for both
 *  matching rows and reporting a real day-count), and its running sums. */
interface Bucket {
  label: string;
  start: string;
  end: string;
  sums: Record<string, number>;
  n: number;
}

/**
 * Collapse daily rows into one row per cycle (chronological, `cycles` order),
 * with a separate, numbered "(no cycle N)" bucket for each stretch of time that
 * falls outside every cycle — before the first, between any two, and after the
 * last if it has a real end date. Each sits in its correct chronological slot
 * (not merged into one trailing bucket), so e.g. a 6-day gap between two
 * cycles gets its own bar between them. A bucket is only emitted when it
 * actually has cost, so the bars still sum to the project's true total without
 * always-there empty ones. Mirrors bucketSeries' "sum every numeric key"
 * contract; `date` on each row is the bucket's display label (cycle name, or
 * "(no cycle N)"), so the existing `<XAxis dataKey="date">` needs no change —
 * each label is unique, which a category axis and ReferenceArea both require.
 *
 * Each row also carries `days` (the bucket's real calendar span — its cycle's
 * own start/end, not a count of days that happened to have cost — needed for
 * a bar *width* proportional to duration, since cycles are rarely equal
 * length) and `start`/`end` (the same window, for tooltips) — see
 * VariableWidthBars, used for the "Cycle" granularity chart.
 */
export function bucketByCycle(daily: Row[], cycles: CycleDef[]): Row[] {
  const dates = daily.map((r) => String(r.date));
  const minDate = dates[0]; // `daily` is sorted ascending by the caller
  const maxDate = dates[dates.length - 1];

  const slots: Pick<Bucket, "label" | "start" | "end">[] = [];
  let gapNumber = 0;
  // A gap's true bounds: the day after the previous cycle's end (or the
  // earliest date actually in range, for the leading gap) through the day
  // before the next cycle's start (or the latest date in range, trailing).
  const addGap = (after: string | null, before: string | null) => {
    const start = after !== null ? addDays(after, 1) : minDate;
    const end = before !== null ? addDays(before, -1) : maxDate;
    if (!start || !end || start > end) return; // no data at all, or an empty window — nothing to show
    gapNumber += 1;
    slots.push({ label: `(${NO_CYCLE_LABEL} ${gapNumber})`, start, end }); // "(no cycle 1)", ...
  };

  if (cycles.length === 0) {
    addGap(null, null); // defensive: shouldn't be called with no cycles, but never lose data
  } else {
    cycles.forEach((c, i) => {
      const prev = cycles[i - 1];
      addGap(prev ? prev.end : null, c.start); // before this cycle (or before the first)
      slots.push({ label: c.name, start: c.start, end: c.end ?? maxDate ?? c.start });
    });
    const last = cycles[cycles.length - 1]!;
    if (last.end !== null) addGap(last.end, null); // after the last cycle, only if it actually ended
  }

  const buckets: Bucket[] = slots.map((s) => ({ ...s, sums: {}, n: 0 }));
  for (const row of daily) {
    const date = String(row.date);
    const bucket = buckets.find((b) => date >= b.start && date <= b.end);
    if (!bucket) continue; // shouldn't happen — slots cover every date — but never throw over a chart
    bucket.n += 1;
    for (const [k, v] of Object.entries(row)) {
      if (k === "date" || typeof v !== "number") continue;
      bucket.sums[k] = (bucket.sums[k] ?? 0) + v;
    }
  }

  // Metadata spreads LAST so it always wins over a same-named group sum (a
  // group literally called "days"/"start"/"end"/"date" would otherwise
  // silently overwrite the bucket's own metadata) — see #30 item 5.
  return buckets
    .filter((b) => b.n > 0)
    .map((b) => ({ ...b.sums, date: b.label, days: daysInclusive(b.start, b.end), start: b.start, end: b.end }));
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
