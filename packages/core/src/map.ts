import type {
  ActivitySummaryEntry,
  CostResultRow,
  OrgProductRow,
  OrgSummaryRow,
  UsageResultRow,
  UserActivityRecord,
  UserCostRow,
  UserDayRow,
  UserProductRow,
  UserUsageRow,
} from "./types.js";

export const MIN_DATE = "2026-01-01";

/** Bucket for cost/usage rows whose actor has no email (e.g. a deleted or service actor). */
export const NO_EMAIL_KEY = "(no email)";

export function toUtcDay(value: string): string {
  return value.slice(0, 10);
}

export function normalizeProduct(p: string | null | undefined): string {
  return p && p.length > 0 ? p : "other";
}

const CENTS_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Parse the API's fractional-cents decimal string into a number of cents, and
 * report whether the input was actually a well-formed decimal amount. A
 * malformed amount (non-numeric, trailing garbage, null/undefined) is never
 * silently accepted — it's reported as unparseable via `ok: false` alongside
 * the `0` fallback, so callers can count and surface the rejection.
 */
export function parseCentsChecked(amount: string | null | undefined): { cents: number; ok: boolean } {
  if (typeof amount !== "string") return { cents: 0, ok: false };
  const trimmed = amount.trim();
  if (!CENTS_PATTERN.test(trimmed)) return { cents: 0, ok: false };
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? { cents: n, ok: true } : { cents: 0, ok: false };
}

/** Parse the API's fractional-cents decimal string into a number of cents. */
export function parseCents(amount: string): number {
  return parseCentsChecked(amount).cents;
}

function normalizeEmail(email: string | null | undefined): string {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed || NO_EMAIL_KEY;
}

// ---- date range helpers ----

/** Inclusive list of UTC days (YYYY-MM-DD). */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${from}..${to} (use YYYY-MM-DD).`);
  }
  if (start > end) throw new Error(`from (${from}) must not be after to (${to}).`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Split [from, to] inclusive days into windows of at most `maxDays` days. */
export function chunkRange(from: string, to: string, maxDays = 31): { from: string; to: string }[] {
  const days = enumerateDays(from, to);
  const chunks: { from: string; to: string }[] = [];
  for (let i = 0; i < days.length; i += maxDays) {
    const slice = days.slice(i, i + maxDays);
    chunks.push({ from: slice[0]!, to: slice[slice.length - 1]! });
  }
  return chunks;
}

/** Next calendar day as YYYY-MM-DD (for exclusive date-only ranges). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Previous calendar day as YYYY-MM-DD (e.g. a cycle's derived end date). */
export function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** RFC 3339 start-of-day / next-day (for [starting_at, ending_at) ranges). */
export function dayStart(date: string): string {
  return `${date}T00:00:00Z`;
}
export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---- record -> domain row mappers ----

export function mapSummary(e: ActivitySummaryEntry): OrgSummaryRow {
  return {
    date: toUtcDay(e.starting_at),
    assignedSeats: e.assigned_seat_count,
    pendingInvites: e.pending_invite_count,
    dailyActiveUsers: e.daily_active_user_count,
    weeklyActiveUsers: e.weekly_active_user_count,
    monthlyActiveUsers: e.monthly_active_user_count,
    coworkDailyActiveUsers: e.cowork_daily_active_user_count,
    dailyAdoptionRate: e.daily_adoption_rate,
    weeklyAdoptionRate: e.weekly_adoption_rate,
    monthlyAdoptionRate: e.monthly_adoption_rate,
  };
}

export function mapUserActivity(date: string, r: UserActivityRecord): UserDayRow {
  const cc = r.claude_code_metrics;
  const tool = cc.tool_actions;
  const accepted =
    tool.edit_tool.accepted_count +
    tool.multi_edit_tool.accepted_count +
    tool.notebook_edit_tool.accepted_count +
    tool.write_tool.accepted_count;
  const rejected =
    tool.edit_tool.rejected_count +
    tool.multi_edit_tool.rejected_count +
    tool.notebook_edit_tool.rejected_count +
    tool.write_tool.rejected_count;
  const office = r.office_metrics;
  const officeMessages =
    office.excel.message_count +
    office.outlook.message_count +
    office.powerpoint.message_count +
    office.word.message_count;
  return {
    date,
    userId: r.user?.id ?? "",
    email: (r.user?.email_address ?? "").trim().toLowerCase(),
    name: r.user?.email_address ?? "",
    chatMessages: r.chat_metrics.message_count,
    chatConversations: r.chat_metrics.distinct_conversation_count,
    ccSessions: cc.core_metrics.distinct_session_count,
    ccCommits: cc.core_metrics.commit_count,
    ccPrs: cc.core_metrics.pull_request_count,
    ccLocAdded: cc.core_metrics.lines_of_code.added_count,
    ccLocRemoved: cc.core_metrics.lines_of_code.removed_count,
    ccToolAccepted: accepted,
    ccToolRejected: rejected,
    coworkMessages: r.cowork_metrics.message_count,
    coworkSessions: r.cowork_metrics.distinct_session_count,
    designMessages: r.design_metrics.message_count,
    officeMessages,
    webSearches: r.web_search_count,
    raw: r,
  };
}

export interface MergeResult<T> {
  rows: T[];
  /** Count of cost amounts that failed to parse as a decimal (see parseCentsChecked). */
  unparseableAmounts: number;
}

/** Merge per-user cost rows + usage rows (both 1d × product) keyed by date|user|product. */
export function mergeUserProducts(cost: UserCostRow[], usage: UserUsageRow[]): MergeResult<UserProductRow> {
  const map = new Map<string, UserProductRow>();
  const keyOf = (date: string, userId: string, product: string) => `${date}|${userId}|${product}`;
  let unparseableAmounts = 0;

  for (const c of cost) {
    const date = toUtcDay(c.starting_at);
    const product = normalizeProduct(c.product);
    const userId = c.actor.user_id;
    const key = keyOf(date, userId, product);
    const row = map.get(key) ?? blankUserProduct(date, userId, c.actor.email, product);
    if (row.email === NO_EMAIL_KEY && c.actor.email) row.email = normalizeEmail(c.actor.email);
    const { cents, ok } = parseCentsChecked(c.amount);
    if (!ok) unparseableAmounts += 1;
    row.costCents += cents;
    if (c.requests) row.requests += c.requests;
    map.set(key, row);
  }
  for (const u of usage) {
    const date = toUtcDay(u.starting_at);
    const product = normalizeProduct(u.product);
    const userId = u.actor.user_id;
    const key = keyOf(date, userId, product);
    const row = map.get(key) ?? blankUserProduct(date, userId, u.actor.email, product);
    if (row.email === NO_EMAIL_KEY && u.actor.email) row.email = normalizeEmail(u.actor.email);
    row.totalTokens += u.total_tokens;
    row.inputTokens += u.uncached_input_tokens;
    row.outputTokens += u.output_tokens;
    row.cacheReadTokens += u.cache_read_input_tokens;
    map.set(key, row);
  }
  return { rows: [...map.values()], unparseableAmounts };
}

function blankUserProduct(
  date: string,
  userId: string,
  email: string | null | undefined,
  product: string,
): UserProductRow {
  return {
    date,
    userId,
    email: normalizeEmail(email),
    product,
    costCents: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
  };
}

/** Merge org cost + usage buckets (both 1d × product) into per-date×product rows. */
export function mergeOrgProducts(
  cost: { starting_at: string; results: CostResultRow[] }[],
  usage: { starting_at: string; results: UsageResultRow[] }[],
): MergeResult<OrgProductRow> {
  const map = new Map<string, OrgProductRow>();
  const keyOf = (date: string, product: string) => `${date}|${product}`;
  let unparseableAmounts = 0;

  for (const bucket of cost) {
    const date = toUtcDay(bucket.starting_at);
    for (const r of bucket.results) {
      const product = normalizeProduct(r.product);
      const key = keyOf(date, product);
      const row = map.get(key) ?? blankOrgProduct(date, product);
      const { cents, ok } = parseCentsChecked(r.amount);
      if (!ok) unparseableAmounts += 1;
      row.costCents += cents;
      if (r.requests) row.requests += r.requests;
      map.set(key, row);
    }
  }
  for (const bucket of usage) {
    const date = toUtcDay(bucket.starting_at);
    for (const r of bucket.results) {
      const product = normalizeProduct(r.product);
      const key = keyOf(date, product);
      const row = map.get(key) ?? blankOrgProduct(date, product);
      row.totalTokens +=
        r.uncached_input_tokens +
        r.output_tokens +
        r.cache_read_input_tokens +
        r.cache_creation.ephemeral_1h_input_tokens +
        r.cache_creation.ephemeral_5m_input_tokens;
      row.inputTokens += r.uncached_input_tokens;
      row.outputTokens += r.output_tokens;
      row.cacheReadTokens += r.cache_read_input_tokens;
      map.set(key, row);
    }
  }
  return { rows: [...map.values()], unparseableAmounts };
}

function blankOrgProduct(date: string, product: string): OrgProductRow {
  return {
    date,
    product,
    costCents: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
  };
}
