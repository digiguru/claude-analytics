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

/** One named period within a project's timeline (e.g. a delivery cycle/sprint). */
export interface CycleDef {
  name: string;
  start: string; // inclusive, YYYY-MM-DD
  end: string | null; // inclusive; null = open-ended (the final cycle only)
}
export interface ProjectCycles {
  project: string;
  cycles: CycleDef[];
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
  /** Static cycle definitions for every project that declared any. */
  projectCycles: ProjectCycles[];
  cycleCount: number;
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
  /** Everyone who touched the group at all, including zero-activity assigned seats. */
  seats: number;
  /** Only those with real activity or spend — see #19. */
  activeUsers: number;
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
  avgCostPerSeat: number;
  avgCostPerActiveUser: number;
  avgTokensPerActiveUser: number;
}
/** One group's cost/tokens on one day — feeds the Groups page's cost-over-time chart. */
export interface GroupDayRow {
  date: string;
  key: string;
  costCents: number;
  totalTokens: number;
}

/** A secondary-breakdown row: a normal GroupRow keyed by the secondary
 *  dimension's value, tagged with which primary group it belongs to. */
export interface GroupRowWithPrimary extends GroupRow {
  primaryKey: string;
}

/** Query for /api/groups, /api/export and /api/export/groups-daily. */
export interface GroupsQuery {
  dimension: Dimension; // "Stacking by"
  from?: string;
  to?: string;
  product?: string;
  filter?: string;
  /** "Quick filter by" value, when its facet is a timeline dimension. */
  scope?: string;
  /** Which timeline facet `scope` belongs to (e.g. "@team") — independent of `dimension`. */
  scopeDimension?: string;
  /** The table's own secondary breakdown dimension (doesn't affect the chart). */
  secondary?: string;
}

export interface GroupsResponse {
  dimension: string;
  product: string | null;
  groups: GroupRow[];
  /** Daily cost/tokens per group key, long format. */
  timeseries: GroupDayRow[];
  /** Every key that appears in `groups`/`timeseries`, ordered by total cost descending. */
  keys: string[];
  /** Projects with non-zero cost under the current scope/filter, cost-desc, no Unassigned.
   *  Drives the Cycle granularity/annotation auto-unlock when it settles to one. */
  activeProjects: string[];
  /** The resolved secondary dimension id, or null when none was requested. */
  secondaryDimension: string | null;
  /** Each primary group's breakdown by the secondary dimension — a table-only
   *  drill-down (flat; group by `primaryKey` client-side). Doesn't affect the
   *  chart, which always stacks by the primary dimension. Empty unless a
   *  `secondary` param was sent. */
  secondaryGroups: GroupRowWithPrimary[];
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
  ccCommits: number;
  ccPrs: number;
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
  /** Project(s) this person overlapped with in range (empty if none/no projects file). */
  projects: string[];
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

/** Reserved Group By id for grouping by raw member email — mirrors core's
 *  MEMBER_DIMENSION_ID. Always available (no CSV/projects file required). */
export const MEMBER_DIMENSION_ID = "@member";
export const MEMBER_DIMENSION_LABEL = "Member (email)";

/** Reserved Group By id for grouping by a project's own cycles — mirrors
 *  core's CYCLE_DIMENSION_ID. Only resolvable server-side when exactly one
 *  project is in scope (see GroupsResponse.activeProjects). */
export const CYCLE_DIMENSION_ID = "@cycle";
export const CYCLE_DIMENSION_LABEL = "Cycle";

/** Parse a response body as JSON, tolerating a 2xx with no body at all (e.g.
 *  204 No Content) instead of letting `res.json()` throw its own opaque
 *  SyntaxError. See #30 item 10. */
export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
    }).then(
      json<{
        ok: boolean;
        summaryDays: number;
        activityDays: number;
        userProductRows: number;
        orgProductRows: number;
        /** null when the requested range had nothing to fetch (before MIN_DATE, or entirely
         *  inside the reporting lag) — distinct from "fetched and found nothing". See #25. */
        effectiveRange: { from: string; to: string } | null;
      }>,
    ),
  overview: (from?: string, to?: string, filter?: string) =>
    fetch(`/api/overview${qs({ from, to, filter })}`).then(json<Overview>),
  groups: (q: GroupsQuery) =>
    fetch(
      `/api/groups${qs({
        groupBy: q.dimension,
        from: q.from,
        to: q.to,
        product: q.product,
        filter: q.filter,
        scope: q.scope,
        scopeDimension: q.scopeDimension,
        secondary: q.secondary,
      })}`,
    ).then(json<GroupsResponse>),
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
      json<{ ok: boolean; projects: number; members: number; cycles: number; warnings: string[]; source: string }>,
    );
  },
  exportUrl: (q: GroupsQuery) =>
    `/api/export${qs({
      groupBy: q.dimension,
      from: q.from,
      to: q.to,
      product: q.product,
      filter: q.filter,
      scope: q.scope,
      scopeDimension: q.scopeDimension,
    })}`,
  exportGroupsDailyUrl: (q: GroupsQuery) =>
    `/api/export/groups-daily${qs({
      groupBy: q.dimension,
      from: q.from,
      to: q.to,
      product: q.product,
      filter: q.filter,
      scope: q.scope,
      scopeDimension: q.scopeDimension,
    })}`,
  exportMembersUrl: (from?: string, to?: string, filter?: string) => `/api/export/members${qs({ from, to, filter })}`,
  exportMembersLongUrl: (from?: string, to?: string, filter?: string) =>
    `/api/export/members-long${qs({ from, to, filter })}`,
};

export const usd = (cents: number) => (Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : "–");
export const tokens = (n: number) =>
  !Number.isFinite(n) ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
