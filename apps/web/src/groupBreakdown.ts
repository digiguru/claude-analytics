// Pivot for the Groups page's "{metric} by {dimension}" totals chart when a
// "Breakdown by" dimension is picked: turn the server's flat secondary rows
// (one per primary×secondary pair) into one chart row per primary group with a
// column per secondary key, so recharts can stack them.
//
// Deliberately mirrors stack.ts (the cost-over-time pivot): the same top-N cap
// plus an "Other" catch-all, the same "Unassigned always renders last" rule,
// and the same reserved key names — so the two charts' legends agree on what
// "Other"/"Unassigned" mean.
import type { GroupRow, GroupRowWithPrimary } from "./api.js";
import { OTHER_KEY, UNASSIGNED_KEY } from "./stack.js";

/** The group total, carried alongside the per-key columns so the chart can put
 *  one label above the whole stack rather than above its topmost segment. */
export const TOTAL_KEY = "__total";
/** Which key's segment sits at the very top of this row's stack. Recharts
 *  drops zero-valued entries before it lays a <LabelList> over a series, so
 *  "the label goes on the last key" isn't enough — the last key is empty for
 *  plenty of groups, and their total label would silently vanish. The chart
 *  puts the label on whichever series this names instead. */
export const TOP_KEY = "__topKey";

export interface BreakdownSeries {
  /** One row per primary group, in the order given —
   *  `{ name, __total, __topKey, [secondaryKey]: value }`. A key the group has
   *  nothing in is absent, not zero (matching stack.ts). */
  rows: Record<string, number | string>[];
  /** The stacking order: top-N secondary keys by total, then "Other", then "Unassigned". */
  keys: string[];
}

/**
 * Pivot `secondaryRows` into stacked chart rows, one per group in
 * `orderedGroups` (whose order — the page's metric/sort choice — is preserved
 * verbatim).
 *
 * `metricKey` picks which GroupRow field is stacked. Only additive fields make
 * an honest stack; ratio metrics (avg cost per seat/active user) are the
 * caller's problem — see GroupTotalsChart, which renders those grouped rather
 * than stacked.
 *
 * Secondary keys are ranked by their total across *every* group (not per
 * group) so a key keeps one colour and one legend entry chart-wide. Everything
 * past `maxKeys` folds into "Other"; "Unassigned" is never folded and always
 * stacks last.
 */
export function buildGroupBreakdown(
  orderedGroups: GroupRow[],
  secondaryRows: GroupRowWithPrimary[],
  metricKey: keyof GroupRow,
  maxKeys = 8,
): BreakdownSeries {
  const groupKeys = new Set(orderedGroups.map((g) => g.key));
  // Only rows whose primary group is actually on the chart — a filter/scope
  // change can leave the two momentarily out of step.
  const rows = secondaryRows.filter((r) => groupKeys.has(r.primaryKey));
  if (rows.length === 0) return { rows: [], keys: [] };

  const totalByKey = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r[metricKey]) || 0;
    totalByKey.set(r.key, (totalByKey.get(r.key) ?? 0) + v);
  }
  const ranked = [...totalByKey.keys()]
    .filter((k) => k !== UNASSIGNED_KEY)
    .sort((a, b) => (totalByKey.get(b) ?? 0) - (totalByKey.get(a) ?? 0));
  const top = new Set(ranked.slice(0, maxKeys));
  const hasOther = ranked.length > top.size;
  const hasUnassigned = totalByKey.has(UNASSIGNED_KEY);

  const keys = [
    ...ranked.filter((k) => top.has(k)),
    ...(hasOther ? [OTHER_KEY] : []),
    ...(hasUnassigned ? [UNASSIGNED_KEY] : []),
  ];

  const byPrimary = new Map<string, Record<string, number | string>>();
  for (const g of orderedGroups) byPrimary.set(g.key, { name: g.key, [TOTAL_KEY]: 0, [TOP_KEY]: "" });
  for (const r of rows) {
    const acc = byPrimary.get(r.primaryKey)!;
    const label = r.key === UNASSIGNED_KEY || top.has(r.key) ? r.key : OTHER_KEY;
    const v = Number(r[metricKey]) || 0;
    acc[label] = (Number(acc[label]) || 0) + v;
    acc[TOTAL_KEY] = (Number(acc[TOTAL_KEY]) || 0) + v;
  }
  // `keys` is bottom-to-top stacking order, so the row's topmost drawn segment
  // is its last non-zero key.
  for (const row of byPrimary.values()) {
    const topmost = [...keys].reverse().find((k) => Number(row[k]) > 0);
    if (topmost) row[TOP_KEY] = topmost;
  }

  return { rows: orderedGroups.map((g) => byPrimary.get(g.key)!), keys };
}
