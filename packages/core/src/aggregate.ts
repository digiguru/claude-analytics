import type { AttributeMap } from "./csv.js";
import { groupKey } from "./join.js";
import { membershipKeys, NO_CYCLE_KEY, type Cycle, type MembershipIndex, type TimelineFacet } from "./projects.js";
import type {
  Attributes,
  Dimension,
  OrgProductRow,
  OrgSummaryRow,
  UserDayRow,
  UserProductRow,
} from "./types.js";

// ============================================================================
// 1) Overview (org-level): cost & usage + adoption, plus heaviest days
// ============================================================================

export interface OverviewDay {
  date: string;
  costCents: number;
  totalTokens: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  dailyAdoptionRate: number;
  assignedSeats: number;
  /** Emails active this day. Present only in the filtered (per-user) overview so
   *  callers can union them into distinct active users per week/month bucket. */
  activeEmails?: string[];
}

export interface ProductTotal {
  product: string;
  costCents: number;
  totalTokens: number;
  requests: number;
}

export interface Overview {
  timeseries: OverviewDay[];
  productTotals: ProductTotal[];
  totalCostCents: number;
  totalTokens: number;
  heaviestDays: { date: string; costCents: number }[];
}

export function buildOverview(summaries: OrgSummaryRow[], orgProducts: OrgProductRow[]): Overview {
  const byDate = new Map<string, OverviewDay>();
  const summaryByDate = new Map(summaries.map((s) => [s.date, s]));

  const dates = new Set<string>([...summaries.map((s) => s.date), ...orgProducts.map((p) => p.date)]);
  for (const date of dates) {
    const s = summaryByDate.get(date);
    byDate.set(date, {
      date,
      costCents: 0,
      totalTokens: 0,
      dailyActiveUsers: s?.dailyActiveUsers ?? 0,
      weeklyActiveUsers: s?.weeklyActiveUsers ?? 0,
      monthlyActiveUsers: s?.monthlyActiveUsers ?? 0,
      dailyAdoptionRate: s?.dailyAdoptionRate ?? 0,
      assignedSeats: s?.assignedSeats ?? 0,
    });
  }

  const productTotals = new Map<string, ProductTotal>();
  for (const p of orgProducts) {
    const day = byDate.get(p.date)!;
    day.costCents += p.costCents;
    day.totalTokens += p.totalTokens;
    const pt = productTotals.get(p.product) ?? { product: p.product, costCents: 0, totalTokens: 0, requests: 0 };
    pt.costCents += p.costCents;
    pt.totalTokens += p.totalTokens;
    pt.requests += p.requests;
    productTotals.set(p.product, pt);
  }

  const timeseries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totalCostCents = timeseries.reduce((s, d) => s + d.costCents, 0);
  const totalTokens = timeseries.reduce((s, d) => s + d.totalTokens, 0);
  const heaviestDays = [...timeseries]
    .map((d) => ({ date: d.date, costCents: d.costCents }))
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 10);

  return {
    timeseries,
    productTotals: [...productTotals.values()].sort((a, b) => b.costCents - a.costCents),
    totalCostCents,
    totalTokens,
    heaviestDays,
  };
}

/**
 * Rebuild an org-style overview from per-user rows, so a member filter can slice
 * cost, tokens and per-product totals. `dailyActiveUsers` becomes the count of
 * distinct active members in range; seats/adoption are org-only and stay 0 here
 * (the caller annotates the view as filtered).
 */
export function buildOverviewFromUsers(userProducts: UserProductRow[], userDays: UserDayRow[]): Overview {
  const byDate = new Map<string, OverviewDay>();
  const activeByDate = new Map<string, Set<string>>();
  const dayOf = (date: string) => {
    let d = byDate.get(date);
    if (!d)
      byDate.set(
        date,
        (d = {
          date,
          costCents: 0,
          totalTokens: 0,
          dailyActiveUsers: 0,
          weeklyActiveUsers: 0,
          monthlyActiveUsers: 0,
          dailyAdoptionRate: 0,
          assignedSeats: 0,
        }),
      );
    return d;
  };

  const productTotals = new Map<string, ProductTotal>();
  for (const r of userProducts) {
    const d = dayOf(r.date);
    d.costCents += r.costCents;
    d.totalTokens += r.totalTokens;
    const pt = productTotals.get(r.product) ?? { product: r.product, costCents: 0, totalTokens: 0, requests: 0 };
    pt.costCents += r.costCents;
    pt.totalTokens += r.totalTokens;
    pt.requests += r.requests;
    productTotals.set(r.product, pt);
  }

  for (const r of userDays) {
    const active =
      r.chatMessages + r.ccSessions + r.coworkMessages + r.designMessages + r.officeMessages + r.webSearches > 0;
    if (!active || !r.email) continue;
    dayOf(r.date);
    let set = activeByDate.get(r.date);
    if (!set) activeByDate.set(r.date, (set = new Set()));
    set.add(r.email);
  }
  for (const [date, set] of activeByDate) {
    const d = dayOf(date);
    d.dailyActiveUsers = set.size;
    d.activeEmails = [...set];
  }

  const timeseries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totalCostCents = timeseries.reduce((s, d) => s + d.costCents, 0);
  const totalTokens = timeseries.reduce((s, d) => s + d.totalTokens, 0);
  const heaviestDays = [...timeseries]
    .map((d) => ({ date: d.date, costCents: d.costCents }))
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 10);

  return {
    timeseries,
    productTotals: [...productTotals.values()].sort((a, b) => b.costCents - a.costCents),
    totalCostCents,
    totalTokens,
    heaviestDays,
  };
}

// ============================================================================
// 2) Group analysis (across CSV/timeline dimensions) — cost, usage, activity
//    per group, plus a keyer abstraction shared by the CSV path (join.ts) and
//    the date-aware timeline path (projects.ts).
// ============================================================================

export interface GroupRow {
  key: string;
  developers: number;
  activeUserDays: number;
  costCents: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  chatMessages: number;
  ccSessions: number;
  ccLocAdded: number;
  ccCommits: number;
  ccPrs: number;
  coworkMessages: number;
  webSearches: number;
  costByProduct: Record<string, number>;
  avgCostPerDeveloper: number;
  avgTokensPerDeveloper: number;
}

interface GroupAcc extends Omit<GroupRow, "developers" | "avgCostPerDeveloper" | "avgTokensPerDeveloper"> {
  emails: Set<string>;
}

function blankAcc(key: string): GroupAcc {
  return {
    key,
    emails: new Set(),
    activeUserDays: 0,
    costCents: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    chatMessages: 0,
    ccSessions: 0,
    ccLocAdded: 0,
    ccCommits: 0,
    ccPrs: 0,
    coworkMessages: 0,
    webSearches: 0,
    costByProduct: {},
  };
}

/**
 * Group keys (with weights summing to 1) that a row's email/date maps to along
 * some dimension. The CSV path (below) ignores the date and always returns a
 * single full-weight key; the timeline path (projects.ts) is date-aware and
 * can split a row's cost across concurrent memberships.
 */
export type RowKeyer = (email: string, date: string) => { key: string; weight: number }[];

/** A keyer over a CSV attribute dimension — date is ignored, weight is always 1. */
export function csvKeyer(attributes: AttributeMap, dimension: Dimension): RowKeyer {
  return (email) => [{ key: groupKey(attributes, email, dimension), weight: 1 }];
}

/** A keyer over a timeline facet (project/team/client) — date-aware, weighted by allocation. */
export function timelineKeyer(index: MembershipIndex, facet: TimelineFacet): RowKeyer {
  return (email, date) => membershipKeys(index, email, date, facet);
}

/**
 * A keyer over a single project's own cycles — date-only (ignores email),
 * weight always 1. Cycles are per-project, so this only makes sense once the
 * caller has already resolved which one project is in scope; see
 * CYCLE_DIMENSION_ID in projects.ts and how the server resolves it (requires
 * exactly one active project). Days outside every cycle key to NO_CYCLE_KEY.
 */
export function cycleKeyer(cycles: Cycle[]): RowKeyer {
  return (_email, date) => {
    for (const c of cycles) {
      if (c.start <= date && (c.end === null || date <= c.end)) return [{ key: c.name, weight: 1 }];
    }
    return [{ key: NO_CYCLE_KEY, weight: 1 }];
  };
}

/** Reserved Group By id for grouping by raw member email — works as a primary
 *  or secondary dimension, regardless of whether a CSV or projects file is loaded. */
export const MEMBER_DIMENSION_ID = "@member";
export const MEMBER_DIMENSION_LABEL = "Member";

/** A keyer over the row's own email — weight always 1, ignores date. */
export function memberKeyer(): RowKeyer {
  return (email) => [{ key: email, weight: 1 }];
}

/** Separator joining a primary and secondary key into one combined key string —
 *  a null character, so it can't collide with a real CSV value or email. */
const SECONDARY_KEY_SEP = "\u0000";

/**
 * Combine two keyers into one for a secondary (drill-down) breakdown: each
 * combined key is "primaryKey<sep>secondaryKey", weighted by the product of
 * both keyers' weights for that row — the Cartesian product of whatever each
 * resolves the row to (usually one entry each, but correctly distributes if
 * either splits a row across concurrent memberships). Apply any timeline
 * filtering to each keyer separately, before combining (see
 * applyTimelineFilterToKeyer) — combining first would break its "same facet as
 * the groupBy" branch, which needs each keyer's own bare, unprefixed keys.
 */
export function combineKeyers(primary: RowKeyer, secondary: RowKeyer): RowKeyer {
  return (email, date) => {
    const primaryEntries = primary(email, date);
    if (primaryEntries.length === 0) return [];
    const secondaryEntries = secondary(email, date);
    if (secondaryEntries.length === 0) return [];
    const out: { key: string; weight: number }[] = [];
    for (const p of primaryEntries) {
      for (const s of secondaryEntries) {
        out.push({ key: `${p.key}${SECONDARY_KEY_SEP}${s.key}`, weight: p.weight * s.weight });
      }
    }
    return out;
  };
}

/** Split a combineKeyers key back into its primary/secondary parts. */
export function splitCombinedKey(key: string): { primary: string; secondary: string } {
  const idx = key.indexOf(SECONDARY_KEY_SEP);
  if (idx === -1) return { primary: key, secondary: "" };
  return { primary: key.slice(0, idx), secondary: key.slice(idx + 1) };
}

/**
 * Scale a userProducts/userDays row's numeric metrics by a weight in [0,1].
 * Used where a keyer isn't available (building the org-style overview, or
 * member exports, from raw per-user rows) but a timeline filter still needs
 * to shave off a fractional share of a row's cost — see makeRowWeight in
 * filter.ts. A weight of 1 returns the row unchanged (no copy).
 */
export function scaleUserProductRow(r: UserProductRow, weight: number): UserProductRow {
  if (weight === 1) return r;
  return {
    ...r,
    costCents: r.costCents * weight,
    totalTokens: r.totalTokens * weight,
    inputTokens: r.inputTokens * weight,
    outputTokens: r.outputTokens * weight,
    cacheReadTokens: r.cacheReadTokens * weight,
    requests: r.requests * weight,
  };
}

export function scaleUserDayRow(r: UserDayRow, weight: number): UserDayRow {
  if (weight === 1) return r;
  return {
    ...r,
    chatMessages: r.chatMessages * weight,
    chatConversations: r.chatConversations * weight,
    ccSessions: r.ccSessions * weight,
    ccCommits: r.ccCommits * weight,
    ccPrs: r.ccPrs * weight,
    ccLocAdded: r.ccLocAdded * weight,
    ccLocRemoved: r.ccLocRemoved * weight,
    ccToolAccepted: r.ccToolAccepted * weight,
    ccToolRejected: r.ccToolRejected * weight,
    coworkMessages: r.coworkMessages * weight,
    coworkSessions: r.coworkSessions * weight,
    designMessages: r.designMessages * weight,
    officeMessages: r.officeMessages * weight,
    webSearches: r.webSearches * weight,
  };
}

/**
 * Aggregate per-user cost/tokens (userProducts) and activity (userDays) using a
 * row keyer. Optionally restrict to a single product (cost/tokens only). Every
 * numeric accumulation is scaled by the row's weight for its key, so a person
 * split across multiple keys (e.g. two concurrent projects) contributes a
 * fractional share to each rather than being double-counted.
 *
 * `developers` counts distinct emails that touched the group at all (not a
 * fractional count) — someone split 60/40 across two projects counts as a
 * developer in both. `activeUserDays` accumulates fractionally to stay
 * consistent with cost.
 */
export function aggregateByKeyer(
  userProducts: UserProductRow[],
  userDays: UserDayRow[],
  keyer: RowKeyer,
  product?: string,
): GroupRow[] {
  const groups = new Map<string, GroupAcc>();
  const accFor = (key: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = blankAcc(key)));
    return g;
  };

  for (const r of userProducts) {
    if (product && r.product !== product) continue;
    if (!r.email) continue;
    for (const { key, weight } of keyer(r.email, r.date)) {
      const g = accFor(key);
      g.emails.add(r.email);
      g.costCents += r.costCents * weight;
      g.totalTokens += r.totalTokens * weight;
      g.inputTokens += r.inputTokens * weight;
      g.outputTokens += r.outputTokens * weight;
      g.requests += r.requests * weight;
      g.costByProduct[r.product] = (g.costByProduct[r.product] ?? 0) + r.costCents * weight;
    }
  }

  // Activity is not product-scoped except Claude Code; include it only for the
  // all-products view (no product filter) to keep per-product numbers clean.
  if (!product) {
    for (const d of userDays) {
      if (!d.email) continue;
      const active =
        d.chatMessages + d.ccSessions + d.coworkMessages + d.designMessages + d.officeMessages + d.webSearches > 0;
      for (const { key, weight } of keyer(d.email, d.date)) {
        const g = accFor(key);
        g.emails.add(d.email);
        if (active) g.activeUserDays += weight;
        g.chatMessages += d.chatMessages * weight;
        g.ccSessions += d.ccSessions * weight;
        g.ccLocAdded += d.ccLocAdded * weight;
        g.ccCommits += d.ccCommits * weight;
        g.ccPrs += d.ccPrs * weight;
        g.coworkMessages += d.coworkMessages * weight;
        g.webSearches += d.webSearches * weight;
      }
    }
  }

  return [...groups.values()]
    .map((g): GroupRow => {
      const developers = g.emails.size;
      const { emails, ...rest } = g;
      void emails;
      return {
        ...rest,
        developers,
        avgCostPerDeveloper: developers ? g.costCents / developers : 0,
        avgTokensPerDeveloper: developers ? g.totalTokens / developers : 0,
      };
    })
    .sort((a, b) => b.costCents - a.costCents);
}

/**
 * Aggregate per-user cost/tokens (userProducts) and activity (userDays) by a CSV
 * dimension. Optionally restrict to a single product (cost/tokens only).
 */
export function aggregateByDimension(
  userProducts: UserProductRow[],
  userDays: UserDayRow[],
  attributes: AttributeMap,
  dimension: Dimension,
  product?: string,
): GroupRow[] {
  return aggregateByKeyer(userProducts, userDays, csvKeyer(attributes, dimension), product);
}

/** One group's cost/tokens on one day, for the cost-over-time chart. */
export interface GroupDayRow {
  date: string;
  key: string;
  costCents: number;
  totalTokens: number;
}

/**
 * Daily cost/tokens per group key (weighted, same semantics as aggregateByKeyer),
 * for the Groups page's cost-over-time chart. `keys` is every key that appears,
 * ordered by total cost descending, so callers get a stable stacking order.
 */
export function aggregateByKeyerOverTime(
  userProducts: UserProductRow[],
  keyer: RowKeyer,
  product?: string,
): { rows: GroupDayRow[]; keys: string[] } {
  const byDateKey = new Map<string, GroupDayRow>();
  const totalsByKey = new Map<string, number>();

  for (const r of userProducts) {
    if (product && r.product !== product) continue;
    if (!r.email) continue;
    for (const { key, weight } of keyer(r.email, r.date)) {
      const id = `${r.date}\u0000${key}`;
      let row = byDateKey.get(id);
      if (!row) byDateKey.set(id, (row = { date: r.date, key, costCents: 0, totalTokens: 0 }));
      row.costCents += r.costCents * weight;
      row.totalTokens += r.totalTokens * weight;
      totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + r.costCents * weight);
    }
  }

  const rows = [...byDateKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  const keys = [...totalsByKey.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  return { rows, keys };
}

// ============================================================================
// 2b) User leaderboard — rank individual users by cost or tokens
// ============================================================================

export interface UserTotal {
  email: string;
  attributes: Attributes | null;
  costCents: number;
  totalTokens: number;
  requests: number;
  costByProduct: Record<string, number>;
}

/** Rank users by total cost (default) or tokens, joining CSV attributes. */
export function rankUsers(
  userProducts: UserProductRow[],
  attributes: AttributeMap,
  opts: { by?: "cost" | "tokens"; limit?: number } = {},
): UserTotal[] {
  const by = opts.by ?? "cost";
  const totals = new Map<string, UserTotal>();
  for (const r of userProducts) {
    if (!r.email) continue;
    let t = totals.get(r.email);
    if (!t)
      totals.set(
        r.email,
        (t = {
          email: r.email,
          attributes: attributes.get(r.email) ?? null,
          costCents: 0,
          totalTokens: 0,
          requests: 0,
          costByProduct: {},
        }),
      );
    t.costCents += r.costCents;
    t.totalTokens += r.totalTokens;
    t.requests += r.requests;
    t.costByProduct[r.product] = (t.costByProduct[r.product] ?? 0) + r.costCents;
  }
  const ranked = [...totals.values()].sort((a, b) =>
    by === "tokens" ? b.totalTokens - a.totalTokens : b.costCents - a.costCents,
  );
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

// ============================================================================
// 3) Member lookup — one user's totals, per-product split, daily series
// ============================================================================

export interface MemberDay {
  date: string;
  costCents: number;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  chatMessages: number;
  ccSessions: number;
  ccLocAdded: number;
  ccToolAccepted: number;
  ccToolRejected: number;
  coworkMessages: number;
  designMessages: number;
  officeMessages: number;
  webSearches: number;
  /** This day's cost split by product (for drill-down). */
  costByProduct: Record<string, number>;
}

export interface MemberSummary {
  email: string;
  attributes: Attributes | null;
  activeDays: number;
  totalCostCents: number;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  chatMessages: number;
  ccSessions: number;
  ccLocAdded: number;
  ccCommits: number;
  ccPrs: number;
  ccToolAccepted: number;
  ccToolRejected: number;
  coworkMessages: number;
  designMessages: number;
  officeMessages: number;
  webSearches: number;
  costByProduct: Record<string, number>;
  daily: MemberDay[];
}

export function summarizeMember(
  userProducts: UserProductRow[],
  userDays: UserDayRow[],
  email: string,
  attributes: Attributes | null,
): MemberSummary {
  const target = email.trim().toLowerCase();
  const days = new Map<string, MemberDay>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d)
      days.set(
        date,
        (d = {
          date,
          costCents: 0,
          totalTokens: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          chatMessages: 0,
          ccSessions: 0,
          ccLocAdded: 0,
          ccToolAccepted: 0,
          ccToolRejected: 0,
          coworkMessages: 0,
          designMessages: 0,
          officeMessages: 0,
          webSearches: 0,
          costByProduct: {},
        }),
      );
    return d;
  };

  const costByProduct: Record<string, number> = {};
  let totalCostCents = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  for (const r of userProducts) {
    if (r.email !== target) continue;
    const d = day(r.date);
    d.costCents += r.costCents;
    d.totalTokens += r.totalTokens;
    d.inputTokens += r.inputTokens;
    d.cacheReadTokens += r.cacheReadTokens;
    d.costByProduct[r.product] = (d.costByProduct[r.product] ?? 0) + r.costCents;
    totalCostCents += r.costCents;
    totalTokens += r.totalTokens;
    inputTokens += r.inputTokens;
    cacheReadTokens += r.cacheReadTokens;
    costByProduct[r.product] = (costByProduct[r.product] ?? 0) + r.costCents;
  }

  let activeDays = 0;
  const totals = {
    chatMessages: 0,
    ccSessions: 0,
    ccLocAdded: 0,
    ccCommits: 0,
    ccPrs: 0,
    ccToolAccepted: 0,
    ccToolRejected: 0,
    coworkMessages: 0,
    designMessages: 0,
    officeMessages: 0,
    webSearches: 0,
  };
  for (const r of userDays) {
    if (r.email !== target) continue;
    const d = day(r.date);
    d.chatMessages += r.chatMessages;
    d.ccSessions += r.ccSessions;
    d.ccLocAdded += r.ccLocAdded;
    d.ccToolAccepted += r.ccToolAccepted;
    d.ccToolRejected += r.ccToolRejected;
    d.coworkMessages += r.coworkMessages;
    d.designMessages += r.designMessages;
    d.officeMessages += r.officeMessages;
    d.webSearches += r.webSearches;
    totals.chatMessages += r.chatMessages;
    totals.ccSessions += r.ccSessions;
    totals.ccLocAdded += r.ccLocAdded;
    totals.ccCommits += r.ccCommits;
    totals.ccPrs += r.ccPrs;
    totals.ccToolAccepted += r.ccToolAccepted;
    totals.ccToolRejected += r.ccToolRejected;
    totals.coworkMessages += r.coworkMessages;
    totals.designMessages += r.designMessages;
    totals.officeMessages += r.officeMessages;
    totals.webSearches += r.webSearches;
    if (r.chatMessages + r.ccSessions + r.coworkMessages + r.designMessages + r.officeMessages + r.webSearches > 0)
      activeDays += 1;
  }

  return {
    email: target,
    attributes,
    activeDays,
    totalCostCents,
    totalTokens,
    inputTokens,
    cacheReadTokens,
    ...totals,
    costByProduct,
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
