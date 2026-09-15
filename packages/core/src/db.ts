import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { OrgProductRow, OrgSummaryRow, UserActivityRecord, UserDayRow, UserProductRow } from "./types.js";

/**
 * Local SQLite cache of Claude Enterprise analytics:
 *  - org_summary   one row per day (active users, seats, adoption)
 *  - org_product   one row per day×product (org cost + tokens)
 *  - user_day      one row per day×user (activity across all products)
 *  - user_product  one row per day×user×product (cost + tokens)
 * All upserts are idempotent so re-syncing a day is safe.
 */
export class MetricsDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS org_summary (
        date TEXT PRIMARY KEY,
        assigned_seats INTEGER, pending_invites INTEGER,
        dau INTEGER, wau INTEGER, mau INTEGER, cowork_dau INTEGER,
        daily_adoption REAL, weekly_adoption REAL, monthly_adoption REAL
      );
      CREATE TABLE IF NOT EXISTS org_product (
        date TEXT NOT NULL, product TEXT NOT NULL,
        cost_cents REAL NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, product)
      );
      CREATE TABLE IF NOT EXISTS user_day (
        date TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT,
        chat_messages INTEGER, chat_conversations INTEGER,
        cc_sessions INTEGER, cc_commits INTEGER, cc_prs INTEGER,
        cc_loc_added INTEGER, cc_loc_removed INTEGER,
        cc_tool_accepted INTEGER, cc_tool_rejected INTEGER,
        cowork_messages INTEGER, cowork_sessions INTEGER,
        design_messages INTEGER, office_messages INTEGER, web_searches INTEGER,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (date, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_day_email ON user_day(email);
      CREATE TABLE IF NOT EXISTS user_product (
        date TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, product TEXT NOT NULL,
        cost_cents REAL NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, user_id, product)
      );
      CREATE INDEX IF NOT EXISTS idx_user_product_email ON user_product(email);
    `);
    this.migrate();
  }

  /** Additive schema changes for databases created before a column existed. */
  private migrate(): void {
    const columns = this.db.prepare(`PRAGMA table_info(org_product)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "cache_read_tokens")) {
      this.db.exec(`ALTER TABLE org_product ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0`);
    }
  }

  upsertSummaries(rows: OrgSummaryRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO org_summary (date, assigned_seats, pending_invites, dau, wau, mau,
        cowork_dau, daily_adoption, weekly_adoption, monthly_adoption)
      VALUES (@date,@assignedSeats,@pendingInvites,@dailyActiveUsers,@weeklyActiveUsers,
        @monthlyActiveUsers,@coworkDailyActiveUsers,@dailyAdoptionRate,@weeklyAdoptionRate,@monthlyAdoptionRate)
      ON CONFLICT(date) DO UPDATE SET
        assigned_seats=excluded.assigned_seats, pending_invites=excluded.pending_invites,
        dau=excluded.dau, wau=excluded.wau, mau=excluded.mau, cowork_dau=excluded.cowork_dau,
        daily_adoption=excluded.daily_adoption, weekly_adoption=excluded.weekly_adoption,
        monthly_adoption=excluded.monthly_adoption
    `);
    this.db.transaction((items: OrgSummaryRow[]) => items.forEach((r) => stmt.run(r)))(rows);
  }

  upsertOrgProducts(rows: OrgProductRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO org_product (date, product, cost_cents, total_tokens, input_tokens, output_tokens, cache_read_tokens, requests)
      VALUES (@date,@product,@costCents,@totalTokens,@inputTokens,@outputTokens,@cacheReadTokens,@requests)
      ON CONFLICT(date,product) DO UPDATE SET
        cost_cents=excluded.cost_cents, total_tokens=excluded.total_tokens,
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
        cache_read_tokens=excluded.cache_read_tokens, requests=excluded.requests
    `);
    this.db.transaction((items: OrgProductRow[]) => items.forEach((r) => stmt.run(r)))(rows);
  }

  upsertUserDays(rows: UserDayRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_day (date, user_id, email, name, chat_messages, chat_conversations,
        cc_sessions, cc_commits, cc_prs, cc_loc_added, cc_loc_removed, cc_tool_accepted, cc_tool_rejected,
        cowork_messages, cowork_sessions, design_messages, office_messages, web_searches, raw_json)
      VALUES (@date,@userId,@email,@name,@chatMessages,@chatConversations,@ccSessions,@ccCommits,@ccPrs,
        @ccLocAdded,@ccLocRemoved,@ccToolAccepted,@ccToolRejected,@coworkMessages,@coworkSessions,
        @designMessages,@officeMessages,@webSearches,@rawJson)
      ON CONFLICT(date,user_id) DO UPDATE SET
        email=excluded.email, name=excluded.name, chat_messages=excluded.chat_messages,
        chat_conversations=excluded.chat_conversations, cc_sessions=excluded.cc_sessions,
        cc_commits=excluded.cc_commits, cc_prs=excluded.cc_prs, cc_loc_added=excluded.cc_loc_added,
        cc_loc_removed=excluded.cc_loc_removed, cc_tool_accepted=excluded.cc_tool_accepted,
        cc_tool_rejected=excluded.cc_tool_rejected, cowork_messages=excluded.cowork_messages,
        cowork_sessions=excluded.cowork_sessions, design_messages=excluded.design_messages,
        office_messages=excluded.office_messages, web_searches=excluded.web_searches, raw_json=excluded.raw_json
    `);
    this.db.transaction((items: UserDayRow[]) =>
      items.forEach((r) => stmt.run({ ...r, rawJson: JSON.stringify(r.raw ?? null) })),
    )(rows);
  }

  upsertUserProducts(rows: UserProductRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_product (date, user_id, email, product, cost_cents, total_tokens,
        input_tokens, output_tokens, cache_read_tokens, requests)
      VALUES (@date,@userId,@email,@product,@costCents,@totalTokens,@inputTokens,@outputTokens,
        @cacheReadTokens,@requests)
      ON CONFLICT(date,user_id,product) DO UPDATE SET
        email=excluded.email, cost_cents=excluded.cost_cents, total_tokens=excluded.total_tokens,
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
        cache_read_tokens=excluded.cache_read_tokens, requests=excluded.requests
    `);
    this.db.transaction((items: UserProductRow[]) => items.forEach((r) => stmt.run(r)))(rows);
  }

  // ---- queries ----

  private dateClause(from?: string, to?: string): { where: string; params: Record<string, string> } {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (from) {
      clauses.push("date >= @from");
      params.from = from;
    }
    if (to) {
      clauses.push("date <= @to");
      params.to = to;
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  getSummaries(from?: string, to?: string): OrgSummaryRow[] {
    const { where, params } = this.dateClause(from, to);
    const rows = this.db.prepare(`SELECT * FROM org_summary ${where} ORDER BY date`).all(params) as Record<
      string,
      number | string
    >[];
    return rows.map((r) => ({
      date: r.date as string,
      assignedSeats: r.assigned_seats as number,
      pendingInvites: r.pending_invites as number,
      dailyActiveUsers: r.dau as number,
      weeklyActiveUsers: r.wau as number,
      monthlyActiveUsers: r.mau as number,
      coworkDailyActiveUsers: r.cowork_dau as number,
      dailyAdoptionRate: r.daily_adoption as number,
      weeklyAdoptionRate: r.weekly_adoption as number,
      monthlyAdoptionRate: r.monthly_adoption as number,
    }));
  }

  getOrgProducts(from?: string, to?: string): OrgProductRow[] {
    const { where, params } = this.dateClause(from, to);
    const rows = this.db.prepare(`SELECT * FROM org_product ${where} ORDER BY date`).all(params) as Record<
      string,
      number | string
    >[];
    return rows.map((r) => ({
      date: r.date as string,
      product: r.product as string,
      costCents: r.cost_cents as number,
      totalTokens: r.total_tokens as number,
      inputTokens: r.input_tokens as number,
      outputTokens: r.output_tokens as number,
      cacheReadTokens: r.cache_read_tokens as number,
      requests: r.requests as number,
    }));
  }

  getUserProducts(opts: { from?: string; to?: string; email?: string } = {}): UserProductRow[] {
    const { where, params } = this.dateClause(opts.from, opts.to);
    let sql = `SELECT * FROM user_product ${where}`;
    if (opts.email) {
      sql += where ? " AND email = @email" : " WHERE email = @email";
      params.email = opts.email.trim().toLowerCase();
    }
    // Consistent with getUserDays' ORDER BY — callers already sort when it
    // matters, so this was benign, but there's no reason for the two to
    // disagree. See #30 item 13.
    const rows = this.db.prepare(`${sql} ORDER BY date`).all(params) as Record<string, number | string>[];
    return rows.map((r) => ({
      date: r.date as string,
      userId: r.user_id as string,
      email: r.email as string,
      product: r.product as string,
      costCents: r.cost_cents as number,
      totalTokens: r.total_tokens as number,
      inputTokens: r.input_tokens as number,
      outputTokens: r.output_tokens as number,
      cacheReadTokens: r.cache_read_tokens as number,
      requests: r.requests as number,
    }));
  }

  /** Columns for a UserDayRow, excluding `raw_json` — the default, since nothing
   *  in aggregate.ts/filter.ts/export.ts reads `.raw` and it's expensive to
   *  reconstitute (one JSON.parse + discarded object per row). Pass
   *  `includeRaw: true` (callers that actually want the raw per-day record) to
   *  add it back. */
  private static readonly USER_DAY_COLUMNS = `date, user_id, email, name, chat_messages, chat_conversations,
    cc_sessions, cc_commits, cc_prs, cc_loc_added, cc_loc_removed, cc_tool_accepted, cc_tool_rejected,
    cowork_messages, cowork_sessions, design_messages, office_messages, web_searches`;

  getUserDays(opts: { from?: string; to?: string; email?: string; includeRaw?: boolean } = {}): UserDayRow[] {
    const { where, params } = this.dateClause(opts.from, opts.to);
    const columns = opts.includeRaw ? `${MetricsDb.USER_DAY_COLUMNS}, raw_json` : MetricsDb.USER_DAY_COLUMNS;
    let sql = `SELECT ${columns} FROM user_day ${where}`;
    if (opts.email) {
      sql += where ? " AND email = @email" : " WHERE email = @email";
      params.email = opts.email.trim().toLowerCase();
    }
    const rows = this.db.prepare(`${sql} ORDER BY date`).all(params) as Record<string, number | string>[];
    return rows.map((r) => ({
      date: r.date as string,
      userId: r.user_id as string,
      email: r.email as string,
      name: (r.name as string) ?? "",
      chatMessages: r.chat_messages as number,
      chatConversations: r.chat_conversations as number,
      ccSessions: r.cc_sessions as number,
      ccCommits: r.cc_commits as number,
      ccPrs: r.cc_prs as number,
      ccLocAdded: r.cc_loc_added as number,
      ccLocRemoved: r.cc_loc_removed as number,
      ccToolAccepted: r.cc_tool_accepted as number,
      ccToolRejected: r.cc_tool_rejected as number,
      coworkMessages: r.cowork_messages as number,
      coworkSessions: r.cowork_sessions as number,
      designMessages: r.design_messages as number,
      officeMessages: r.office_messages as number,
      webSearches: r.web_searches as number,
      raw: opts.includeRaw ? (JSON.parse(r.raw_json as string) as UserActivityRecord) : undefined,
    }));
  }

  distinctEmails(): string[] {
    // Union activity (user_day) and cost (user_product): some accounts have spend
    // but no tracked daily activity, and must still surface as members / filterable
    // groups (otherwise they show up as an "(unmatched)" group you can't select).
    const rows = this.db
      .prepare(
        `SELECT DISTINCT email FROM (
           SELECT email FROM user_day WHERE email <> ''
           UNION
           SELECT email FROM user_product WHERE email <> ''
         ) ORDER BY email`,
      )
      .all() as { email: string }[];
    return rows.map((r) => r.email);
  }

  dateRange(): { min: string; max: string } | null {
    const row = this.db
      .prepare(
        `SELECT MIN(d) AS min, MAX(d) AS max FROM (
           SELECT date d FROM user_day UNION SELECT date FROM org_summary UNION SELECT date FROM user_product
         )`,
      )
      .get() as { min: string | null; max: string | null };
    return row.min && row.max ? { min: row.min, max: row.max } : null;
  }

  close(): void {
    this.db.close();
  }
}
