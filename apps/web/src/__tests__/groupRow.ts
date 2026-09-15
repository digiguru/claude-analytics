import type { GroupRow, GroupRowWithPrimary } from "../api.js";

/** A minimal but complete GroupRow, for component tests that need real rows
 *  without depending on aggregation logic (that's packages/core's job). */
export function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    key: "Alpha",
    seats: 1,
    activeUsers: 1,
    activeUserDays: 1,
    costCents: 100,
    totalTokens: 10,
    inputTokens: 4,
    outputTokens: 6,
    requests: 1,
    chatMessages: 0,
    ccSessions: 0,
    ccLocAdded: 0,
    ccCommits: 0,
    ccPrs: 0,
    coworkMessages: 0,
    webSearches: 0,
    costByProduct: {},
    avgCostPerSeat: 100,
    avgCostPerActiveUser: 100,
    avgTokensPerActiveUser: 10,
    ...overrides,
  };
}

export function groupRowWithPrimary(overrides: Partial<GroupRowWithPrimary> = {}): GroupRowWithPrimary {
  return { ...groupRow(), primaryKey: "Alpha", ...overrides };
}
