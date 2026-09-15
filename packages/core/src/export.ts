import { stringify } from "csv-stringify/sync";
import type { AttributeMap } from "./csv.js";
import type { GroupDayRow, GroupRow } from "./aggregate.js";
import type { Attributes, Dimension, UserProductRow } from "./types.js";

/** Convert group aggregates into CSV text (cost rendered in dollars). */
export function groupsToCsv(groups: GroupRow[], dimension: Dimension): string {
  const rows = groups.map((g) => ({
    [dimension]: g.key,
    seats: g.seats,
    active_users: g.activeUsers,
    active_user_days: Math.round(g.activeUserDays * 10) / 10,
    total_cost_usd: (g.costCents / 100).toFixed(2),
    avg_cost_per_seat_usd: (g.avgCostPerSeat / 100).toFixed(2),
    avg_cost_per_active_user_usd: (g.avgCostPerActiveUser / 100).toFixed(2),
    total_tokens: g.totalTokens,
    requests: g.requests,
    chat_messages: g.chatMessages,
    cc_sessions: g.ccSessions,
    cc_loc_added: g.ccLocAdded,
    cc_commits: g.ccCommits,
    cc_prs: g.ccPrs,
    cowork_messages: g.coworkMessages,
    web_searches: g.webSearches,
  }));
  return stringify(rows, { header: true });
}

/** Long/tidy CSV of a group's cost over time: one row per group per day. */
export function groupsDailyToCsv(rows: GroupDayRow[], dimension: Dimension): string {
  const out = rows.map((r) => ({
    [dimension]: r.key,
    date: r.date,
    total_cost_usd: (r.costCents / 100).toFixed(2),
    total_tokens: r.totalTokens,
  }));
  return stringify(out, { header: true, columns: [dimension, "date", "total_cost_usd", "total_tokens"] });
}

export interface MemberDailyRow {
  email: string;
  attributes: Attributes | null;
  /** date -> cost in cents for that day. */
  costByDate: Record<string, number>;
  totalCostCents: number;
  totalTokens: number;
  requests: number;
}

/**
 * Build one row per person seen in Claude analytics, joining CSV attributes
 * where they match (blank when they don't). `emails` seeds the population with
 * everyone from Claude — including users with activity but no cost, who then
 * carry zeros. Returns the ordered set of dates present so callers can pivot
 * cost into a column per day.
 */
export function membersDailyCost(
  userProducts: UserProductRow[],
  attributes: AttributeMap,
  emails: string[],
): { rows: MemberDailyRow[]; dates: string[] } {
  const byEmail = new Map<string, MemberDailyRow>();
  const seed = (email: string) => {
    let row = byEmail.get(email);
    if (!row)
      byEmail.set(
        email,
        (row = {
          email,
          attributes: attributes.get(email) ?? null,
          costByDate: {},
          totalCostCents: 0,
          totalTokens: 0,
          requests: 0,
        }),
      );
    return row;
  };

  for (const email of emails) seed(email);

  const dateSet = new Set<string>();
  for (const r of userProducts) {
    if (!r.email) continue;
    const row = seed(r.email);
    row.costByDate[r.date] = (row.costByDate[r.date] ?? 0) + r.costCents;
    row.totalCostCents += r.costCents;
    row.totalTokens += r.totalTokens;
    row.requests += r.requests;
    dateSet.add(r.date);
  }

  return {
    rows: [...byEmail.values()].sort((a, b) => b.totalCostCents - a.totalCostCents),
    dates: [...dateSet].sort(),
  };
}

/**
 * Wide CSV: email, CSV attribute columns, one cost column per day (dollars),
 * then the period totals.
 */
export function membersDailyToCsv(rows: MemberDailyRow[], dates: string[], attributeColumns: string[]): string {
  const out = rows.map((r) => {
    const row: Record<string, string | number> = { email: r.email };
    for (const col of attributeColumns) row[col] = r.attributes?.[col] ?? "";
    for (const d of dates) row[d] = ((r.costByDate[d] ?? 0) / 100).toFixed(2);
    row.total_cost_usd = (r.totalCostCents / 100).toFixed(2);
    row.total_tokens = r.totalTokens;
    row.requests = r.requests;
    return row;
  });
  const columns = ["email", ...attributeColumns, ...dates, "total_cost_usd", "total_tokens", "requests"];
  return stringify(out, { header: true, columns });
}

/**
 * Long/tidy CSV: one row per member per day with cost in dollars —
 * columns Member, Date, Cost. Days with no cost are omitted.
 */
export function membersDailyLongToCsv(rows: MemberDailyRow[], dates: string[]): string {
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    for (const d of dates) {
      const cents = r.costByDate[d];
      if (cents === undefined) continue;
      out.push({ Member: r.email, Date: d, Cost: (cents / 100).toFixed(2) });
    }
  }
  return stringify(out, { header: true, columns: ["Member", "Date", "Cost"] });
}
