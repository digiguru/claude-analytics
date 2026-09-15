import {
  MetricsDb,
  type OrgProductRow,
  type OrgSummaryRow,
  type UserDayRow,
  type UserProductRow,
} from "@claude-analytics/core";

/** A fresh in-memory MetricsDb for one test — real SQLite, no file on disk. */
export function testDb(): MetricsDb {
  return new MetricsDb(":memory:");
}

// ---- minimal row builders for seeding a test DB (kept local to apps/cli's
// own tests rather than reused from packages/core's __fixtures__, which
// isn't part of core's public exports — same approach as apps/server's) ----

export function summaryRow(overrides: Partial<OrgSummaryRow> = {}): OrgSummaryRow {
  return {
    date: "2026-06-01",
    assignedSeats: 10,
    pendingInvites: 0,
    dailyActiveUsers: 5,
    weeklyActiveUsers: 8,
    monthlyActiveUsers: 10,
    coworkDailyActiveUsers: 0,
    dailyAdoptionRate: 0.5,
    weeklyAdoptionRate: 0.8,
    monthlyAdoptionRate: 1,
    ...overrides,
  };
}

export function orgProductRow(overrides: Partial<OrgProductRow> = {}): OrgProductRow {
  return {
    date: "2026-06-01",
    product: "chat",
    costCents: 100,
    totalTokens: 10,
    inputTokens: 4,
    outputTokens: 6,
    cacheReadTokens: 0,
    requests: 1,
    ...overrides,
  };
}

export function userProductRow(overrides: Partial<UserProductRow> = {}): UserProductRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    product: "chat",
    costCents: 100,
    totalTokens: 10,
    inputTokens: 4,
    outputTokens: 6,
    cacheReadTokens: 0,
    requests: 1,
    ...overrides,
  };
}

export function userDayRow(overrides: Partial<UserDayRow> = {}): UserDayRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    name: "a@x.com",
    chatMessages: 1,
    chatConversations: 1,
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
    ...overrides,
  };
}
