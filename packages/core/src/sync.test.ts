import { test, expect } from "vitest";
import type { EnterpriseClient } from "./client.js";
import { MetricsDb } from "./db.js";
import { fetchRange } from "./sync.js";
import type {
  ActivitySummaryEntry,
  BucketResponse,
  CostResultRow,
  UsageResultRow,
  UserActivityRecord,
  UserCostRow,
  UserUsageRow,
} from "./types.js";

function fakeClient(overrides: Partial<EnterpriseClient> = {}): EnterpriseClient {
  return {
    getSummaries: async () => [],
    getUserActivity: async () => [],
    getUserCost: async () => [],
    getUserUsage: async () => [],
    getOrgCost: async () => [],
    getOrgUsage: async () => [],
    ...overrides,
  };
}

function blankActivityRecord(): UserActivityRecord {
  return {
    chat_metrics: {
      message_count: 0,
      distinct_conversation_count: 0,
      distinct_projects_created_count: 0,
      distinct_projects_used_count: 0,
      distinct_artifacts_created_count: 0,
      distinct_files_uploaded_count: 0,
      distinct_skills_used_count: 0,
      connectors_used_count: 0,
      thinking_message_count: 0,
      shared_conversations_viewed_count: 0,
      distinct_shared_artifacts_viewed_count: 0,
    },
    claude_code_metrics: {
      core_metrics: {
        commit_count: 0,
        distinct_session_count: 0,
        pull_request_count: 0,
        lines_of_code: { added_count: 0, removed_count: 0 },
      },
      tool_actions: {
        edit_tool: { accepted_count: 0, rejected_count: 0 },
        multi_edit_tool: { accepted_count: 0, rejected_count: 0 },
        notebook_edit_tool: { accepted_count: 0, rejected_count: 0 },
        write_tool: { accepted_count: 0, rejected_count: 0 },
      },
    },
    cowork_metrics: {
      message_count: 0,
      action_count: 0,
      dispatch_turn_count: 0,
      distinct_session_count: 0,
      distinct_skills_used_count: 0,
      skills_used_count: 0,
      connectors_used_count: 0,
      distinct_connectors_used_count: 0,
    },
    design_metrics: {
      message_count: 0,
      distinct_session_count: 0,
      distinct_projects_created_count: 0,
      distinct_projects_used_count: 0,
    },
    office_metrics: {
      excel: {
        message_count: 0,
        distinct_session_count: 0,
        skills_used_count: 0,
        distinct_skills_used_count: 0,
        connectors_used_count: 0,
        distinct_connectors_used_count: 0,
      },
      outlook: {
        message_count: 0,
        distinct_session_count: 0,
        skills_used_count: 0,
        distinct_skills_used_count: 0,
        connectors_used_count: 0,
        distinct_connectors_used_count: 0,
      },
      powerpoint: {
        message_count: 0,
        distinct_session_count: 0,
        skills_used_count: 0,
        distinct_skills_used_count: 0,
        connectors_used_count: 0,
        distinct_connectors_used_count: 0,
      },
      word: {
        message_count: 0,
        distinct_session_count: 0,
        skills_used_count: 0,
        distinct_skills_used_count: 0,
        connectors_used_count: 0,
        distinct_connectors_used_count: 0,
      },
    },
    web_search_count: 0,
  };
}

test("fetchRange: a normal historical range fetches summaries, activity, and cost/usage", async () => {
  const client = fakeClient({
    getSummaries: async (): Promise<ActivitySummaryEntry[]> => [
      {
        starting_at: "2026-06-01T00:00:00Z",
        ending_at: "2026-06-02T00:00:00Z",
        assigned_seat_count: 10,
        pending_invite_count: 0,
        daily_active_user_count: 5,
        weekly_active_user_count: 5,
        monthly_active_user_count: 5,
        cowork_daily_active_user_count: 0,
        cowork_weekly_active_user_count: 0,
        cowork_monthly_active_user_count: 0,
        daily_adoption_rate: 0.5,
        weekly_adoption_rate: 0.5,
        monthly_adoption_rate: 0.5,
      },
    ],
    getUserActivity: async (): Promise<UserActivityRecord[]> => [blankActivityRecord()],
    getUserCost: async (): Promise<UserCostRow[]> => [
      {
        actor: { user_id: "u1", email: "a@x.com" },
        amount: "100",
        list_amount: "100",
        currency: "USD",
        product: "chat",
        requests: 1,
        starting_at: "2026-06-01T00:00:00Z",
        ending_at: "2026-06-02T00:00:00Z",
      },
    ],
    getUserUsage: async (): Promise<UserUsageRow[]> => [],
    getOrgCost: async (): Promise<BucketResponse<CostResultRow>["data"]> => [],
    getOrgUsage: async (): Promise<BucketResponse<UsageResultRow>["data"]> => [],
  });
  const db = new MetricsDb(":memory:");
  const result = await fetchRange(client, db, "2026-06-01", "2026-06-01");
  expect(result.effectiveRange).not.toBe(null);
  expect(result.summaryDays).toBe(1);
  expect(result.activityDays).toBe(1);
  expect(result.userProductRows).toBe(1);
  db.close();
});

test("fetchRange: a range entirely inside the reporting lag has nothing to fetch, and says so distinguishably (#25)", async () => {
  const client = fakeClient();
  const db = new MetricsDb(":memory:");
  const today = new Date().toISOString().slice(0, 10);
  const result = await fetchRange(client, db, today, today);
  expect(result.effectiveRange).toBe(null);
  expect(result.summaryDays).toBe(0);
  expect(result.activityDays).toBe(0);
  expect(result.userProductRows).toBe(0);
  expect(result.orgProductRows).toBe(0);
  db.close();
});

test("fetchRange: unparseable cost amounts are counted across both user and org merges", async () => {
  const client = fakeClient({
    getUserCost: async (): Promise<UserCostRow[]> => [
      {
        actor: { user_id: "u1", email: "a@x.com" },
        amount: "not-a-number",
        list_amount: "0",
        currency: "USD",
        product: "chat",
        requests: 1,
        starting_at: "2026-06-01T00:00:00Z",
        ending_at: "2026-06-02T00:00:00Z",
      },
    ],
    getOrgCost: async (): Promise<BucketResponse<CostResultRow>["data"]> => [
      {
        starting_at: "2026-06-01T00:00:00Z",
        ending_at: "2026-06-02T00:00:00Z",
        results: [
          { amount: "also-not-a-number", list_amount: "0", currency: "USD", product: "chat", model: null, requests: 1 },
        ],
      },
    ],
  });
  const db = new MetricsDb(":memory:");
  const result = await fetchRange(client, db, "2026-06-01", "2026-06-01");
  expect(result.unparseableAmounts).toBe(2);
  db.close();
});
