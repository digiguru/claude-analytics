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

export function createClient(apiKey: string): EnterpriseClient {
  if (!apiKey) {
    throw new Error("Missing Analytics API key. Set ANTHROPIC_ANALYTICS_API_KEY in your .env file.");
  }

  async function get<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "user-agent": USER_AGENT,
      },
    });
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

  /** Page through any endpoint that returns { data, next_page }. */
  async function paginate<Row>(
    path: string,
    baseParams: Record<string, string | string[]>,
    extract: (resp: { data: Row[]; next_page: string | null }) => Row[],
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let page: string | undefined;
    do {
      const params = { ...baseParams, ...(page ? { page } : {}) };
      const resp = await get<{ data: Row[]; next_page: string | null }>(path, params);
      rows.push(...extract(resp));
      page = resp.next_page ?? undefined;
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
