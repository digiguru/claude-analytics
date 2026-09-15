import type {
  ActivitySummaryEntry,
  BucketResponse,
  CostResultRow,
  SummariesResponse,
  UsageResultRow,
  UserActivityRecord,
  UserActivityResponse,
  UserCostResponse,
  UserCostRow,
  UserUsageResponse,
  UserUsageRow,
} from "./types.js";

const BASE = "https://api.anthropic.com/v1/organizations/analytics";
const ANTHROPIC_VERSION = "2023-06-01";
const USER_AGENT = "claude-analytics-explorer/0.2.0 (https://github.com/)";

export class AnalyticsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "AnalyticsApiError";
  }
}

export interface EnterpriseClient {
  getSummaries(startingDate: string, endingDate: string): Promise<ActivitySummaryEntry[]>;
  getUserActivity(date: string): Promise<UserActivityRecord[]>;
  getUserCost(startingAt: string, endingAt: string): Promise<UserCostRow[]>;
  getUserUsage(startingAt: string, endingAt: string): Promise<UserUsageRow[]>;
  getOrgCost(startingAt: string, endingAt: string): Promise<BucketResponse<CostResultRow>["data"]>;
  getOrgUsage(startingAt: string, endingAt: string): Promise<BucketResponse<UsageResultRow>["data"]>;
}

export interface ClientOptions {
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable delay for tests — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Abort a single HTTP request after this many ms (default 30s). */
  timeoutMs?: number;
  /** Extra attempts after the first, for a 429/5xx response or a network/timeout error (default 3). */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries, doubled each attempt (default 500ms). */
  baseDelayMs?: number;
  /** Hard cap on pages fetched per paginated call (default 1000) — a looping `next_page`
   *  cursor throws a descriptive error past this rather than growing memory unbounded. */
  maxPages?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_PAGES = 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

/** Parse a `Retry-After` header (either delay-seconds or an HTTP-date) into a millisecond delay. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

export function createClient(apiKey: string, opts: ClientOptions = {}): EnterpriseClient {
  if (!apiKey) {
    throw new Error("Missing Analytics API key. Set ANTHROPIC_ANALYTICS_API_KEY in your .env file.");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

  /**
   * GET with a per-request timeout and exponential-backoff retry on a 429,
   * a 5xx, or a network/timeout error — honouring `Retry-After` when the
   * server sends one. Per #25: a single transient failure (or a rate limit,
   * per the API's 60 req/min org-wide cap) used to abort an entire sync.
   */
  async function get<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, v);
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "user-agent": USER_AGENT,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        if (attempt < maxRetries) {
          await sleep(backoffDelay(attempt, baseDelayMs));
          continue;
        }
        if (isTimeout) throw new Error(`Analytics API ${path} timed out after ${timeoutMs}ms.`, { cause: err });
        throw err;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = retryAfterMs(res.headers.get("retry-after")) ?? backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let hint = "";
        if (res.status === 401 || res.status === 403) {
          hint =
            " — this API needs a Claude Enterprise Analytics API key (sk-ant-api01-...) with the" +
            " read:analytics scope, created in claude.ai > Organization settings > API.";
        }
        const snippet = body ? ` ${body.slice(0, 300)}` : "";
        throw new AnalyticsApiError(`Analytics API ${path} failed (${res.status})${hint}${snippet}`, res.status, body);
      }
      return (await res.json()) as T;
    }
  }

  /** Page through any endpoint that returns { data, next_page }, capped at
   *  `maxPages` — see ClientOptions.maxPages. */
  async function paginate<Row>(
    path: string,
    baseParams: Record<string, string | string[]>,
    extract: (resp: { data: Row[]; next_page: string | null }) => Row[],
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let page: string | undefined;
    let pageCount = 0;
    do {
      if (pageCount >= maxPages) {
        throw new Error(`Analytics API ${path}: exceeded ${maxPages} pages — likely a looping pagination cursor.`);
      }
      const params = { ...baseParams, ...(page ? { page } : {}) };
      const resp = await get<{ data: Row[]; next_page: string | null }>(path, params);
      rows.push(...extract(resp));
      page = resp.next_page ?? undefined;
      pageCount++;
    } while (page);
    return rows;
  }

  return {
    async getSummaries(startingDate, endingDate) {
      const resp = await get<SummariesResponse>("/summaries", {
        starting_date: startingDate,
        ending_date: endingDate,
      });
      return resp.summaries;
    },

    getUserActivity(date) {
      return paginate<UserActivityRecord>(
        "/users",
        { date, limit: "1000" },
        (r) => (r as unknown as UserActivityResponse).data,
      );
    },

    getUserCost(startingAt, endingAt) {
      return paginate<UserCostRow>(
        "/user_cost_report",
        {
          starting_at: startingAt,
          ending_at: endingAt,
          bucket_width: "1d",
          "group_by[]": "product",
          limit: "1000",
        },
        (r) => (r as unknown as UserCostResponse).data,
      );
    },

    getUserUsage(startingAt, endingAt) {
      return paginate<UserUsageRow>(
        "/user_usage_report",
        {
          starting_at: startingAt,
          ending_at: endingAt,
          bucket_width: "1d",
          "group_by[]": "product",
          limit: "1000",
        },
        (r) => (r as unknown as UserUsageResponse).data,
      );
    },

    getOrgCost(startingAt, endingAt) {
      return paginate(
        "/cost_report",
        {
          starting_at: startingAt,
          ending_at: endingAt,
          bucket_width: "1d",
          "group_by[]": "product",
          limit: "31",
        },
        (r) => (r as unknown as BucketResponse<CostResultRow>).data,
      );
    },

    getOrgUsage(startingAt, endingAt) {
      return paginate(
        "/usage_report",
        {
          starting_at: startingAt,
          ending_at: endingAt,
          bucket_width: "1d",
          "group_by[]": "product",
          limit: "31",
        },
        (r) => (r as unknown as BucketResponse<UsageResultRow>).data,
      );
    },
  };
}
