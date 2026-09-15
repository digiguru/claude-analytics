import type { EnterpriseClient } from "./client.js";
import type { MetricsDb } from "./db.js";
import {
  chunkRange,
  dayAfter,
  dayStart,
  enumerateDays,
  nextDay,
  mapSummary,
  mapUserActivity,
  mergeOrgProducts,
  mergeUserProducts,
  MIN_DATE,
} from "./map.js";

export interface SyncProgress {
  step: string;
  detail: string;
}

export interface SyncResult {
  summaryDays: number;
  activityDays: number;
  userProductRows: number;
  orgProductRows: number;
  /** Cost amounts that failed to parse as a decimal and were recorded as 0 (see parseCentsChecked). */
  unparseableAmounts: number;
  /**
   * The range actually fetched, or `null` when the requested [from, to] fell
   * entirely before MIN_DATE or inside the reporting lag — nothing to fetch,
   * not "fetched and found nothing". See #25: previously this returned a
   * nonsensical `{ from: start, to }` where `to` was *before* `from`, which
   * the CLI/UI had no way to distinguish from a real (if empty) result.
   */
  effectiveRange: { from: string; to: string } | null;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Subtract N days from a YYYY-MM-DD date. */
function minusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch all analytics for [from, to] into the cache. Dates are clamped to what
 * the API can serve: nothing before 2026-01-01, activity/summaries lag 3 days,
 * cost/usage exclude the still-settling current day.
 */
export async function fetchRange(
  client: EnterpriseClient,
  db: MetricsDb,
  from: string,
  to: string,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const today = utcToday();
  const start = maxDate(from, MIN_DATE);
  const activityEnd = minDate(to, minusDays(today, 3));
  const costEnd = minDate(to, minusDays(today, 1));

  let summaryDays = 0;
  let activityDays = 0;
  let userProductRows = 0;
  let orgProductRows = 0;
  let unparseableAmounts = 0;

  // 1) Org summaries (single call, range up to 366 days). `ending_date` is
  // exclusive per the Analytics API reference, hence nextDay — confirmed
  // against docs, consistent with the cost/usage endpoints' `ending_at`
  // below (also exclusive, hence dayAfter). See #25 item 5.
  if (start <= activityEnd) {
    onProgress?.({ step: "summaries", detail: `${start}..${activityEnd}` });
    const summaries = await client.getSummaries(start, nextDay(activityEnd));
    db.upsertSummaries(summaries.map(mapSummary));
    summaryDays = summaries.length;
  }

  // 2) Per-user activity (one call per day)
  if (start <= activityEnd) {
    for (const day of enumerateDays(start, activityEnd)) {
      const records = await client.getUserActivity(day);
      db.upsertUserDays(records.map((r) => mapUserActivity(day, r)));
      activityDays += 1;
      onProgress?.({ step: "activity", detail: `${day}: ${records.length} users` });
    }
  }

  // 3) Per-user + org cost/usage (chunked into <=31-day windows)
  if (start <= costEnd) {
    for (const chunk of chunkRange(start, costEnd, 31)) {
      const startingAt = dayStart(chunk.from);
      const endingAt = dayAfter(chunk.to);

      onProgress?.({ step: "user-cost", detail: `${chunk.from}..${chunk.to}` });
      const [userCost, userUsage] = await Promise.all([
        client.getUserCost(startingAt, endingAt),
        client.getUserUsage(startingAt, endingAt),
      ]);
      const userMerge = mergeUserProducts(userCost, userUsage);
      db.upsertUserProducts(userMerge.rows);
      userProductRows += userMerge.rows.length;
      unparseableAmounts += userMerge.unparseableAmounts;

      onProgress?.({ step: "org-cost", detail: `${chunk.from}..${chunk.to}` });
      const [orgCost, orgUsage] = await Promise.all([
        client.getOrgCost(startingAt, endingAt),
        client.getOrgUsage(startingAt, endingAt),
      ]);
      const orgMerge = mergeOrgProducts(orgCost, orgUsage);
      db.upsertOrgProducts(orgMerge.rows);
      orgProductRows += orgMerge.rows.length;
      unparseableAmounts += orgMerge.unparseableAmounts;
    }
  }

  const fetchedAnything = start <= activityEnd || start <= costEnd;
  return {
    summaryDays,
    activityDays,
    userProductRows,
    orgProductRows,
    unparseableAmounts,
    effectiveRange: fetchedAnything ? { from: start, to: maxDate(activityEnd, costEnd) } : null,
  };
}
