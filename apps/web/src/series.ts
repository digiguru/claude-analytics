// Time-series shaping shared by the overview and member charts:
// regroup daily rows into day / week / month buckets, fit a linear trend,
// and optionally project a short forecast off that trend.

export type Granularity = "day" | "week" | "month";

/** How a metric collapses when several days fall into one bucket.
 *  Totals (cost, tokens, message counts) sum; rates/levels (active users) average. */
export type Agg = "sum" | "avg";

export interface SeriesOptions {
  granularity: Granularity;
  showTrend: boolean;
  showForecast: boolean;
  /** Metric the trend line and forecast follow (the bar series, e.g. "cost"). */
  trendKey: string;
  /** Per-metric aggregation. Keys absent here are summed. */
  aggs: Record<string, Agg>;
}

export interface PreparedSeries {
  /** Chart rows. Historical rows carry the real metric keys; forecast rows
   *  carry `${trendKey}Forecast` instead. Both carry `trend` when enabled. */
  data: Row[];
  /** First forecast bucket label, or null when no forecast is shown. */
  forecastStart: string | null;
}

type Row = Record<string, number | string | null>;

const FORECAST_PERIODS: Record<Granularity, number> = { day: 14, week: 8, month: 6 };

function parseUTC(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y ?? NaN, (m ?? 1) - 1, day ?? 1));
}

function fmtUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Monday-anchored ISO week start, as a YYYY-MM-DD label. */
function weekStart(d: string): string {
  const dt = parseUTC(d);
  const diff = (dt.getUTCDay() + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return fmtUTC(dt);
}

export function bucketLabel(date: string, g: Granularity): string {
  if (g === "week") return weekStart(date);
  if (g === "month") return date.slice(0, 7); // YYYY-MM
  return date;
}

/** Number of days a full bucket of granularity `g` spans, for the given label.
 *  Days are always 1; weeks 7; months vary, so derive from the label's month. */
function fullPeriodDays(label: string, g: Granularity): number {
  if (g === "day") return 1;
  if (g === "week") return 7;
  const [y, m] = label.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, m ?? 1, 0)).getUTCDate(); // day 0 of next month = last of this
}

/** How many daily rows fell into `label`'s bucket — i.e. how far into the period we are. */
function daysInBucket(daily: Row[], g: Granularity, label: string): number {
  let n = 0;
  for (const row of daily) if (bucketLabel(String(row.date), g) === label) n++;
  return n;
}

/** The bucket label `i` periods after `last`. */
function advance(last: string, g: Granularity, i: number): string {
  if (g === "month") {
    const [y, m] = last.split("-").map(Number);
    const total = (y ?? 0) * 12 + (m ?? 1) - 1 + i;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  }
  const step = g === "week" ? 7 : 1;
  const dt = parseUTC(last);
  dt.setUTCDate(dt.getUTCDate() + step * i);
  return fmtUTC(dt);
}

/** Collapse daily rows into the requested granularity, aggregating each metric. */
export function bucketSeries(daily: Row[], g: Granularity, aggs: Record<string, Agg>): Row[] {
  if (g === "day") return daily.map((r) => ({ ...r }));

  const order: string[] = [];
  const sums = new Map<string, Record<string, number>>();
  const counts = new Map<string, number>();

  for (const row of daily) {
    const label = bucketLabel(String(row.date), g);
    if (!sums.has(label)) {
      sums.set(label, {});
      counts.set(label, 0);
      order.push(label);
    }
    const acc = sums.get(label)!;
    counts.set(label, counts.get(label)! + 1);
    for (const [k, v] of Object.entries(row)) {
      if (k === "date" || typeof v !== "number") continue;
      acc[k] = (acc[k] ?? 0) + v;
    }
  }

  return order.map((label) => {
    const acc = sums.get(label)!;
    const n = counts.get(label)!;
    const out: Row = { date: label };
    for (const [k, total] of Object.entries(acc)) {
      out[k] = aggs[k] === "avg" ? Math.round(total / n) : total;
    }
    return out;
  });
}

/** Ordinary least-squares fit of y against its index (0..n-1). */
function linearFit(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i]!;
    sxy += i * ys[i]!;
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Bucket the data, then layer on trend and forecast per the options. */
export function prepareSeries(daily: Row[], opts: SeriesOptions): PreparedSeries {
  const { granularity, showTrend, showForecast, trendKey, aggs } = opts;
  const bucketed = bucketSeries(daily, granularity, aggs);
  const data: Row[] = bucketed.map((r) => ({ ...r }));

  if ((!showTrend && !showForecast) || data.length < 2) {
    return { data, forecastStart: null };
  }

  const ys = bucketed.map((r) => Number(r[trendKey] ?? 0));

  // If the final bucket is still in progress (fewer days elapsed than the period
  // spans), its raw total understates the period. Project it to a full-period
  // estimate — (total so far / days elapsed) × days in period — so it neither drags
  // the trend down nor reads as a real drop. The historical bar keeps its raw value;
  // only the trend fit and the forecast seed use the projected figure.
  const lastLabel = String(bucketed[bucketed.length - 1]!.date);
  const elapsed = daysInBucket(daily, granularity, lastLabel);
  const fullDays = fullPeriodDays(lastLabel, granularity);
  const lastIsPartial = elapsed > 0 && elapsed < fullDays;
  const projectedLast = lastIsPartial ? (ys[ys.length - 1]! / elapsed) * fullDays : ys[ys.length - 1]!;
  if (lastIsPartial) ys[ys.length - 1] = projectedLast;

  const { slope, intercept } = linearFit(ys);
  const at = (i: number) => Math.max(0, intercept + slope * i);

  if (showTrend) data.forEach((row, i) => (row.trend = at(i)));

  let forecastStart: string | null = null;
  if (showForecast) {
    const last = lastLabel;
    const periods = FORECAST_PERIODS[granularity];
    // Seed the forecast bar at the last point (projected to a full period when the
    // bucket is still in progress) so the dashed bars read as a continuation.
    data[data.length - 1]![`${trendKey}Forecast`] = projectedLast;
    for (let k = 1; k <= periods; k++) {
      const i = bucketed.length - 1 + k;
      const label = advance(last, granularity, k);
      if (k === 1) forecastStart = label;
      const row: Row = { date: label, [`${trendKey}Forecast`]: at(i) };
      if (showTrend) row.trend = at(i);
      data.push(row);
    }
  }

  return { data, forecastStart };
}
