// Thin client for the local backend. The browser never talks to Anthropic directly.

/** Dynamic: whatever non-`email` columns the uploaded CSV carried (original casing). */
export type Attributes = Record<string, string>;

/** A timeline (Project/Team/Client) dimension, with the distinct values it can take
 *  (for the filter menu's facet list — CSV facet values come from the user list instead). */
export interface TimelineDimension {
  id: string; // "@project" | "@team" | "@client"
  label: string; // "Project" | "Team" | "Client"
  values: string[];
}

export interface Status {
  csvLoaded: boolean;
  csvSource: string | null;
  csvRows: number;
  dimensions: string[];
  projectsLoaded: boolean;
  projectsSource: string | null;
  projectCount: number;
  projectWarnings: string[];
  timelineDimensions: TimelineDimension[];
  cachedDateRange: { min: string; max: string } | null;
  developerCount: number;
  apiKeyConfigured: boolean;
}

export interface OverviewDay {
  date: string;
  costCents: number;
  totalTokens: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  dailyAdoptionRate: number;
  assignedSeats: number;
  /** Emails active this day; present only in the filtered view. Lets the chart
   *  count distinct active users per week/month bucket rather than averaging. */
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
  /** True when a member filter rebuilt this from per-user data (seats/adoption are then org-wide). */
  filtered?: boolean;
}

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
/** One group's cost/tokens on one day — feeds the Groups page's cost-over-time chart. */
export interface GroupDayRow {
  date: string;
  key: string;
  costCents: number;
  totalTokens: number;
}

export interface GroupsResponse {
  dimension: string;
  product: string | null;
  groups: GroupRow[];
  /** Daily cost/tokens per group key, long format. */
  timeseries: GroupDayRow[];
  /** Every key that appears in `groups`/`timeseries`, ordered by total cost descending. */
  keys: string[];
  unmatchedCount: number;
}

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

export interface UserListEntry {
  email: string;
  attributes: Attributes | null;
  /** Timeline facet id ("@project" etc.) -> group keys this user overlapped with
   *  in the queried range (or the whole cache). Undefined when no projects file
   *  is loaded. See activeFacetKeysInRange in core for the "overlap" semantics. */
  groups?: Record<string, string[]>;
}

export type Dimension = string;
export const PRODUCTS = ["chat", "claude_code", "cowork", "office_agent", "claude_design", "other"];

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  status: () => fetch("/api/status").then(json<Status>),
  sync: (from: string, to: string) =>
    fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    }).then(json<{ ok: boolean; summaryDays: number; activityDays: number; userProductRows: number; orgProductRows: number }>),
  overview: (from?: string, to?: string, filter?: string) =>
    fetch(`/api/overview${qs({ from, to, filter })}`).then(json<Overview>),
  groups: (dimension: Dimension, from?: string, to?: string, product?: string, filter?: string) =>
    fetch(`/api/groups${qs({ groupBy: dimension, from, to, product, filter })}`).then(json<GroupsResponse>),
  users: (from?: string, to?: string) => fetch(`/api/users${qs({ from, to })}`).then(json<{ users: UserListEntry[] }>),
  member: (email: string, from?: string, to?: string) =>
    fetch(`/api/members/${encodeURIComponent(email)}${qs({ from, to })}`).then(json<MemberSummary>),
  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/csv", { method: "POST", body: form }).then(json<{ ok: boolean; rows: number; source: string }>);
  },
  uploadProjects: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/projects", { method: "POST", body: form }).then(
      json<{ ok: boolean; projects: number; members: number; warnings: string[]; source: string }>,
    );
  },
  exportUrl: (dimension: Dimension, from?: string, to?: string, product?: string, filter?: string) =>
    `/api/export${qs({ groupBy: dimension, from, to, product, filter })}`,
  exportGroupsDailyUrl: (dimension: Dimension, from?: string, to?: string, product?: string, filter?: string) =>
    `/api/export/groups-daily${qs({ groupBy: dimension, from, to, product, filter })}`,
  exportMembersUrl: (from?: string, to?: string, filter?: string) =>
    `/api/export/members${qs({ from, to, filter })}`,
  exportMembersLongUrl: (from?: string, to?: string, filter?: string) =>
    `/api/export/members-long${qs({ from, to, filter })}`,
};

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
