// Boots a real server (not a Vitest `inject`) with a seeded in-memory DB and
// serves the built web/dist bundle, for Playwright's webServer to point a
// real browser at. Reuses the same buildApp/AppState the API smoke test
// (apps/server/src/smoke.test.ts, #35) exercises in-process — this is that
// same boot path, just over a fixed port for a real browser to hit. Run via
// `node --import tsx e2e/seed-server.ts` (see playwright.config.ts).
import { buildApp } from "../apps/server/src/app.js";
import { AppState } from "../apps/server/src/state.js";
import {
  MetricsDb,
  parseAttributesCsv,
  type OrgProductRow,
  type OrgSummaryRow,
  type UserDayRow,
  type UserProductRow,
} from "@claude-analytics/core";

const PORT = 4173;

function summaryRow(overrides: Partial<OrgSummaryRow> = {}): OrgSummaryRow {
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

function orgProductRow(overrides: Partial<OrgProductRow> = {}): OrgProductRow {
  return {
    date: "2026-06-01",
    product: "chat",
    costCents: 1234,
    totalTokens: 5000,
    inputTokens: 2000,
    outputTokens: 3000,
    cacheReadTokens: 0,
    requests: 10,
    ...overrides,
  };
}

function userProductRow(overrides: Partial<UserProductRow> = {}): UserProductRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    product: "chat",
    costCents: 1234,
    totalTokens: 5000,
    inputTokens: 2000,
    outputTokens: 3000,
    cacheReadTokens: 0,
    requests: 10,
    ...overrides,
  };
}

function userDayRow(overrides: Partial<UserDayRow> = {}): UserDayRow {
  return {
    date: "2026-06-01",
    userId: "u1",
    email: "a@x.com",
    name: "a@x.com",
    chatMessages: 3,
    chatConversations: 1,
    ccSessions: 1,
    ccCommits: 0,
    ccPrs: 0,
    ccLocAdded: 10,
    ccLocRemoved: 2,
    ccToolAccepted: 1,
    ccToolRejected: 0,
    coworkMessages: 0,
    coworkSessions: 0,
    designMessages: 0,
    officeMessages: 0,
    webSearches: 1,
    ...overrides,
  };
}

const config = {
  apiKey: "e2e-test-key",
  dbPath: ":memory:",
  csvPath: undefined,
  projectsPath: undefined,
  port: PORT,
  allowedOrigins: [],
};
// Three people across two Roles and two Levels, so the Groups page has both a
// "Stacking by" dimension *and* a distinct "Breakdown by" one to stack by —
// and so at least one primary group (Engineer) splits into two segments rather
// than a single-colour bar. Costs are deliberately all different so a label or
// tooltip figure can only match one of them.
const PEOPLE = [
  { userId: "u1", email: "a@x.com", costCents: 1234 },
  { userId: "u2", email: "b@x.com", costCents: 2000 },
  { userId: "u3", email: "c@x.com", costCents: 500 },
];

const db = new MetricsDb(config.dbPath);
db.upsertSummaries([summaryRow()]);
db.upsertOrgProducts([orgProductRow()]);
db.upsertUserProducts(PEOPLE.map((p) => userProductRow(p)));
db.upsertUserDays(PEOPLE.map(({ userId, email }) => userDayRow({ userId, email, name: email })));

const state = new AppState(config, db);
// A minimal CSV so the Groups page has a "Stacking by" dimension to
// auto-select — with none loaded it has nothing to group by at all, and
// stays blank rather than fetching/rendering a chart. The second column gives
// "Breakdown by" something to offer that isn't whatever is being stacked by.
const { attributes, count } = parseAttributesCsv(
  "email,Role,Level\na@x.com,Engineer,Senior\nb@x.com,Engineer,Junior\nc@x.com,Designer,Senior\n",
);
state.setAttributes(attributes, `e2e seed CSV (${count} row(s))`);

const app = buildApp(state, { serveStatic: true });

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => console.log(`e2e seed server listening on http://127.0.0.1:${PORT}`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
