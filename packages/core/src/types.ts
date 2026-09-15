// ============================================================================
// Claude Enterprise Analytics API
// Base: https://api.anthropic.com/v1/organizations/analytics/
// Auth: x-api-key (Analytics API key, read:analytics scope) + anthropic-version
// Data available from 2026-01-01; activity/summaries have a 3-day finalization
// lag; cost/usage refresh ~every 4h and revise for up to 30 days.
// ============================================================================

export const PRODUCTS = [
  "chat",
  "claude_code",
  "cowork",
  "office_agent",
  "claude_in_chrome",
  "claude_design",
  "other",
] as const;
export type Product = (typeof PRODUCTS)[number];

// ---- Raw API shapes (subset of fields we use) ----

export interface AnalyticsUser {
  id: string;
  email_address: string;
}

export interface AnalyticsUserActor {
  user_id: string;
  email?: string | null;
  name?: string | null;
  deleted?: boolean;
  type?: "user_actor";
}

export interface ToolActionCounts {
  accepted_count: number;
  rejected_count: number;
}

export interface ChatMetrics {
  message_count: number;
  distinct_conversation_count: number;
  distinct_projects_created_count: number;
  distinct_projects_used_count: number;
  distinct_artifacts_created_count: number;
  distinct_files_uploaded_count: number;
  distinct_skills_used_count: number;
  connectors_used_count: number;
  thinking_message_count: number;
  shared_conversations_viewed_count: number;
  distinct_shared_artifacts_viewed_count: number;
}

export interface ClaudeCodeCoreMetrics {
  commit_count: number;
  distinct_session_count: number;
  pull_request_count: number;
  lines_of_code: { added_count: number; removed_count: number };
}

export interface ClaudeCodeMetrics {
  core_metrics: ClaudeCodeCoreMetrics;
  tool_actions: {
    edit_tool: ToolActionCounts;
    multi_edit_tool: ToolActionCounts;
    notebook_edit_tool: ToolActionCounts;
    write_tool: ToolActionCounts;
  };
}

export interface CoworkMetrics {
  message_count: number;
  action_count: number;
  dispatch_turn_count: number;
  distinct_session_count: number;
  distinct_skills_used_count: number;
  skills_used_count: number;
  connectors_used_count: number;
  distinct_connectors_used_count: number;
}

export interface DesignMetrics {
  message_count: number;
  distinct_session_count: number;
  distinct_projects_created_count: number;
  distinct_projects_used_count: number;
}

export interface OfficeProductMetrics {
  message_count: number;
  distinct_session_count: number;
  skills_used_count: number;
  distinct_skills_used_count: number;
  connectors_used_count: number;
  distinct_connectors_used_count: number;
}

export interface OfficeMetrics {
  excel: OfficeProductMetrics;
  outlook: OfficeProductMetrics;
  powerpoint: OfficeProductMetrics;
  word: OfficeProductMetrics;
}

/** One record from GET /analytics/users (per user, per day). */
export interface UserActivityRecord {
  user?: AnalyticsUser;
  chat_metrics: ChatMetrics;
  claude_code_metrics: ClaudeCodeMetrics;
  cowork_metrics: CoworkMetrics;
  design_metrics: DesignMetrics;
  office_metrics: OfficeMetrics;
  web_search_count: number;
}

export interface UserActivityResponse {
  data: UserActivityRecord[];
  next_page: string | null;
}

export interface ActivitySummaryEntry {
  starting_at: string;
  ending_at: string;
  assigned_seat_count: number;
  pending_invite_count: number;
  daily_active_user_count: number;
  weekly_active_user_count: number;
  monthly_active_user_count: number;
  cowork_daily_active_user_count: number;
  cowork_weekly_active_user_count: number;
  cowork_monthly_active_user_count: number;
  daily_adoption_rate: number;
  weekly_adoption_rate: number;
  monthly_adoption_rate: number;
}

export interface SummariesResponse {
  summaries: ActivitySummaryEntry[];
}

// Per-user cost / usage report rows (with bucket_width=1d + group_by=product)
export interface UserCostRow {
  actor: AnalyticsUserActor;
  amount: string; // fractional cents
  list_amount: string;
  currency: "USD";
  product: string | null;
  requests: number | null;
  starting_at: string;
  ending_at: string;
}

export interface UserCostResponse {
  data: UserCostRow[];
  data_refreshed_at: string;
  has_more: boolean;
  next_page: string | null;
}

export interface UserUsageRow {
  actor: AnalyticsUserActor;
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number };
  total_tokens: number;
  requests: number;
  product: string | null;
  starting_at: string;
  ending_at: string;
}

export interface UserUsageResponse {
  data: UserUsageRow[];
  data_refreshed_at: string;
  has_more: boolean;
  next_page: string | null;
}

// Org-level cost / usage over time (bucketed)
export interface CostResultRow {
  amount: string;
  list_amount: string;
  currency: "USD";
  product: string | null;
  model: string | null;
  requests: number | null;
}

export interface UsageResultRow {
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number };
  product: string | null;
  model: string | null;
  requests: number;
}

export interface BucketResponse<T> {
  data: { starting_at: string; ending_at: string; results: T[] }[];
  data_refreshed_at: string;
  has_more: boolean;
  next_page: string | null;
}

// ============================================================================
// Domain shapes (flattened, cache-friendly, used across CLI/server/web)
// ============================================================================

/**
 * Developer attributes are dynamic: whatever non-`email` columns appear in the
 * CSV become available dimensions. Keys preserve the CSV's original header
 * casing (trimmed); lookups are case-insensitive (see join.ts).
 */
export type Attributes = Record<string, string>;

/** A dimension is just the name of a CSV column to group by. */
export type Dimension = string;

/** Org-wide daily summary (one row per day). */
export interface OrgSummaryRow {
  date: string;
  assignedSeats: number;
  pendingInvites: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  coworkDailyActiveUsers: number;
  dailyAdoptionRate: number;
  weeklyAdoptionRate: number;
  monthlyAdoptionRate: number;
}

/** Org-wide daily cost + tokens for one product (one row per date×product). */
export interface OrgProductRow {
  date: string;
  product: string;
  costCents: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
}

/** Per-user, per-day activity across all products (flattened scalars + raw). */
export interface UserDayRow {
  date: string;
  userId: string;
  email: string; // lowercased; "" if unavailable
  name: string;
  chatMessages: number;
  chatConversations: number;
  ccSessions: number;
  ccCommits: number;
  ccPrs: number;
  ccLocAdded: number;
  ccLocRemoved: number;
  ccToolAccepted: number;
  ccToolRejected: number;
  coworkMessages: number;
  coworkSessions: number;
  designMessages: number;
  officeMessages: number;
  webSearches: number;
  raw: UserActivityRecord;
}

/** Per-user, per-day cost + tokens for one product. */
export interface UserProductRow {
  date: string;
  userId: string;
  email: string;
  product: string;
  costCents: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
}

export interface UserProductWithAttributes extends UserProductRow {
  attributes: Attributes | null;
  name: string;
}
