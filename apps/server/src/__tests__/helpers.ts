import {
  MetricsDb,
  parseAttributesCsv,
  parseProjectsYaml,
  type OrgProductRow,
  type OrgSummaryRow,
  type UserDayRow,
  type UserProductRow,
} from "@claude-analytics/core";
import { AppState, type ServerConfig } from "../state.js";

/**
 * A fresh AppState backed by an in-memory SQLite DB, with no CSV/projects
 * file loaded by default — no real server, no real file on disk, no side
 * effects. `dirname(":memory:")` resolves to "." (see MetricsDb), so this
 * works with no changes to MetricsDb itself. Explicitly overrides
 * csvPath/projectsPath to undefined rather than leaving them to loadConfig's
 * defaults, so a test run never accidentally picks up this repo's real
 * config/projects.yaml or .env.
 */
export function makeTestState(overrides: Partial<ServerConfig> = {}): AppState {
  const config: ServerConfig = {
    apiKey: "test-api-key",
    dbPath: ":memory:",
    csvPath: undefined,
    projectsPath: undefined,
    port: 0,
    allowedOrigins: [],
    ...overrides,
  };
  return new AppState(config, new MetricsDb(config.dbPath));
}

/** Seed a test state's attributes CSV from an inline CSV string. */
export function withCsv(state: AppState, csv: string): AppState {
  const { attributes, count } = parseAttributesCsv(csv);
  state.setAttributes(attributes, `test csv (${count} rows)`);
  return state;
}

/** Seed a test state's projects/teams from an inline YAML string. */
export function withProjects(state: AppState, yaml: string): AppState {
  const result = parseProjectsYaml(yaml);
  state.setProjects(result, `test projects (${result.projectCount} project(s))`);
  return state;
}

// ---- minimal row builders for seeding a test DB (kept local to apps/server's
// own tests rather than reused from packages/core's __fixtures__, which isn't
// part of core's public exports) ----

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
