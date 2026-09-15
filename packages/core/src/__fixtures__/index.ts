import type {
  AnalyticsUserActor,
  CostResultRow,
  OrgProductRow,
  UsageResultRow,
  UserCostRow,
  UserDayRow,
  UserProductRow,
  UserUsageRow,
} from "../types.js";

/** Minimal builder helpers for core fixtures — extend, don't duplicate, in later test files. */

export function actor(overrides: Partial<AnalyticsUserActor> = {}): AnalyticsUserActor {
  return { user_id: "u1", email: "a@x.com", ...overrides };
}

export function userCostRow(overrides: Partial<UserCostRow> = {}): UserCostRow {
  return {
    actor: actor(),
    amount: "100",
    list_amount: "100",
    currency: "USD",
    product: "chat",
    requests: 1,
    starting_at: "2026-06-01T00:00:00Z",
    ending_at: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

export function userUsageRow(overrides: Partial<UserUsageRow> = {}): UserUsageRow {
  return {
    actor: actor(),
    uncached_input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 5,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    total_tokens: 35,
    requests: 1,
    product: "chat",
    starting_at: "2026-06-01T00:00:00Z",
    ending_at: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

export function costResultRow(overrides: Partial<CostResultRow> = {}): CostResultRow {
  return {
    amount: "100",
    list_amount: "100",
    currency: "USD",
    product: "chat",
    model: null,
    requests: 1,
    ...overrides,
  };
}

export function usageResultRow(overrides: Partial<UsageResultRow> = {}): UsageResultRow {
  return {
    uncached_input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 5,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    product: "chat",
    model: null,
    requests: 1,
    ...overrides,
  };
}

export function costBucket(
  starting_at: string,
  results: Partial<CostResultRow>[],
): { starting_at: string; results: CostResultRow[] } {
  return { starting_at, results: results.map((r) => costResultRow(r)) };
}

export function usageBucket(
  starting_at: string,
  results: Partial<UsageResultRow>[],
): { starting_at: string; results: UsageResultRow[] } {
  return { starting_at, results: results.map((r) => usageResultRow(r)) };
}

export function userProductRow(overrides: Partial<UserProductRow> = {}): UserProductRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    product: "chat",
    costCents: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
    ...overrides,
  };
}

export function orgProductRow(overrides: Partial<OrgProductRow> = {}): OrgProductRow {
  return {
    date: "2026-06-01",
    product: "chat",
    costCents: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
    ...overrides,
  };
}

export function userDayRow(overrides: Partial<UserDayRow> = {}): UserDayRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    name: "a@x.com",
    chatMessages: 0,
    chatConversations: 0,
    ccSessions: 0,
    ccCommits: 0,
    ccPrs: 0,
    ccLocAdded: 0,
    ccLocRemoved: 0,
    ccToolAccepted: 0,
    ccToolRejected: 0,
    coworkMessages: 0,
    coworkSessions: 0,
    designMessages: 0,
    officeMessages: 0,
    webSearches: 0,
    raw: {
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
    },
    ...overrides,
  };
}
