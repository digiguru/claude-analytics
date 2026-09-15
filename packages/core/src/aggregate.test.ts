import { test, expect } from "vitest";
import {
  aggregateByDimension,
  aggregateByKeyer,
  aggregateByKeyerOverTime,
  buildOverview,
  buildOverviewFromUsers,
  combineKeyers,
  csvKeyer,
  cycleKeyer,
  memberKeyer,
  rankUsers,
  scaleUserDayRow,
  scaleUserProductRow,
  splitCombinedKey,
  summarizeMember,
  timelineKeyer,
} from "./aggregate.js";
import { cyclesFor, NO_CYCLE_KEY, parseProjectsYaml } from "./projects.js";
import type { UserDayRow, UserProductRow } from "./types.js";
import { orgProductRow, userDayRow, userProductRow } from "./__fixtures__/index.js";

function product(email: string, date: string, costCents: number): UserProductRow {
  return {
    date,
    userId: email,
    email,
    product: "chat",
    costCents,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    requests: 1,
  };
}

const emptyDays: UserDayRow[] = [];
const SEP = "\u0000";

test("splitCombinedKey round-trips a plain combineKeyers key", () => {
  expect(splitCombinedKey(`Team A${SEP}ann@x.com`)).toEqual({ primary: "Team A", secondary: "ann@x.com" });
});

test("splitCombinedKey handles a key with no separator (shouldn't happen, but stays safe)", () => {
  expect(splitCombinedKey("just-primary")).toEqual({ primary: "just-primary", secondary: "" });
});

test("combineKeyers: two whole-weight keyers (CSV x Member) — secondary breakdown sums to the primary total", () => {
  const attrs = new Map([
    ["ann@x.com", { Team: "Alpha" }],
    ["bob@x.com", { Team: "Alpha" }],
    ["cas@x.com", { Team: "Beta" }],
  ]);
  const rows: UserProductRow[] = [
    product("ann@x.com", "2026-06-01", 100),
    product("bob@x.com", "2026-06-01", 50),
    product("cas@x.com", "2026-06-01", 30),
  ];

  const primary = csvKeyer(attrs, "Team");
  const primaryOnly = aggregateByKeyer(rows, emptyDays, primary);
  const alphaTotal = primaryOnly.find((g) => g.key === "Alpha")!.costCents;
  expect(alphaTotal).toBe(150);

  const combined = combineKeyers(primary, memberKeyer());
  const nested = aggregateByKeyer(rows, emptyDays, combined);
  const alphaMembers = nested
    .map((g) => ({ ...splitCombinedKey(g.key), costCents: g.costCents }))
    .filter((g) => g.primary === "Alpha");
  expect(alphaMembers.length).toBe(2);
  const sum = alphaMembers.reduce((s, g) => s + g.costCents, 0);
  expect(sum).toBe(alphaTotal); // secondary breakdown reconciles with the primary total
});

test("combineKeyers: a concurrently-split person's cost is distributed correctly across BOTH dimensions", () => {
  // ann is 60/40 across two projects on the same day — the Cartesian product
  // must preserve that split when grouping by @project with a member secondary.
  const yaml = `
projects:
  - name: Acme
    members:
      - email: ann@x.com
        start: 2026-06-01
        allocation: 0.6
  - name: Globex
    members:
      - email: ann@x.com
        start: 2026-06-01
        allocation: 0.4
`;
  const { index } = parseProjectsYaml(yaml);
  const rows: UserProductRow[] = [product("ann@x.com", "2026-06-01", 100)];

  const combined = combineKeyers(timelineKeyer(index, "project"), memberKeyer());
  const nested = aggregateByKeyer(rows, emptyDays, combined);
  const byKey = new Map(nested.map((g) => [g.key, g.costCents]));
  expect(byKey.get(`Acme${SEP}ann@x.com`)).toBe(60);
  expect(byKey.get(`Globex${SEP}ann@x.com`)).toBe(40);
  expect(nested.length).toBe(2);
});

test("cycleKeyer: groups a project's cost by which of its own cycles each day falls in", () => {
  const yaml = `
projects:
  - name: Acme
    cycles:
      - name: Discovery
        start: 2026-06-01
      - name: Build
        start: 2026-06-04
    members:
      - email: ann@x.com
        start: 2026-06-01
`;
  const { cycles } = parseProjectsYaml(yaml);
  const rows: UserProductRow[] = [
    product("ann@x.com", "2026-06-01", 100), // Discovery
    product("ann@x.com", "2026-06-03", 50), // Discovery (derived end, day before Build)
    product("ann@x.com", "2026-06-04", 30), // Build
    product("ann@x.com", "2026-05-20", 10), // before any cycle -> NO_CYCLE_KEY
  ];

  const keyer = cycleKeyer(cyclesFor(cycles, "Acme"));
  const groups = aggregateByKeyer(rows, emptyDays, keyer);
  const byKey = new Map(groups.map((g) => [g.key, g.costCents]));
  expect(byKey.get("Discovery")).toBe(150);
  expect(byKey.get("Build")).toBe(30);
  expect(byKey.get(NO_CYCLE_KEY)).toBe(10);
});

// ---- aggregateByKeyer: seats vs activeUsers (#19) ----

test("aggregateByKeyer: seats counts everyone touched, activeUsers only those with real activity or spend (#19)", () => {
  const attrs = new Map([
    ["ann@x.com", { Team: "Alpha" }],
    ["bob@x.com", { Team: "Alpha" }],
  ]);
  // ann: a cost row (billed -> active). bob: a user_day row with zero activity
  // (an assigned seat that never touched the product).
  const userProducts: UserProductRow[] = [product("ann@x.com", "2026-06-01", 100)];
  const userDays: UserDayRow[] = [userDayRow({ email: "bob@x.com", date: "2026-06-01" })];

  const [group] = aggregateByKeyer(userProducts, userDays, csvKeyer(attrs, "Team"));
  expect(group!.seats).toBe(2); // ann + bob both touched the group
  expect(group!.activeUsers).toBe(1); // only ann actually used it
  expect(group!.avgCostPerSeat).toBe(50); // 100 / 2 seats
  expect(group!.avgCostPerActiveUser).toBe(100); // 100 / 1 active user
});

test("aggregateByKeyer: a user_day row with real activity counts toward both seats and activeUsers", () => {
  const attrs = new Map([["ann@x.com", { Team: "Alpha" }]]);
  const userDays: UserDayRow[] = [userDayRow({ email: "ann@x.com", date: "2026-06-01", chatMessages: 3 })];
  const [group] = aggregateByKeyer([], userDays, csvKeyer(attrs, "Team"));
  expect(group!.seats).toBe(1);
  expect(group!.activeUsers).toBe(1);
  expect(group!.activeUserDays).toBe(1);
});

// ---- buildOverview / buildOverviewFromUsers: reconciliation (#15) ----

test("buildOverview and buildOverviewFromUsers agree on totals for equivalent multi-user, multi-product, multi-day data (#15)", () => {
  // Two users, two products, two days — org rows are what mergeOrgProducts
  // would produce for the same underlying events; user rows are the same
  // events split by user. The two paths must reconcile.
  const orgRows = [
    orgProductRow({ date: "2026-06-01", product: "chat", costCents: 100, totalTokens: 40, requests: 1 }),
    orgProductRow({ date: "2026-06-01", product: "claude_code", costCents: 200, totalTokens: 80, requests: 2 }),
    orgProductRow({ date: "2026-06-02", product: "chat", costCents: 50, totalTokens: 20, requests: 1 }),
  ];
  const userRows: UserProductRow[] = [
    userProductRow({
      date: "2026-06-01",
      userId: "u1",
      email: "a@x.com",
      product: "chat",
      costCents: 60,
      totalTokens: 25,
      requests: 1,
    }),
    userProductRow({
      date: "2026-06-01",
      userId: "u2",
      email: "b@x.com",
      product: "chat",
      costCents: 40,
      totalTokens: 15,
      requests: 0,
    }),
    userProductRow({
      date: "2026-06-01",
      userId: "u1",
      email: "a@x.com",
      product: "claude_code",
      costCents: 200,
      totalTokens: 80,
      requests: 2,
    }),
    userProductRow({
      date: "2026-06-02",
      userId: "u2",
      email: "b@x.com",
      product: "chat",
      costCents: 50,
      totalTokens: 20,
      requests: 1,
    }),
  ];

  const org = buildOverview([], orgRows);
  const users = buildOverviewFromUsers(userRows, []);

  expect(users.totalCostCents).toBe(org.totalCostCents);
  expect(users.totalTokens).toBe(org.totalTokens);
  expect(users.productTotals).toEqual(org.productTotals);
  expect(users.timeseries.map((d) => ({ date: d.date, costCents: d.costCents, totalTokens: d.totalTokens }))).toEqual(
    org.timeseries.map((d) => ({ date: d.date, costCents: d.costCents, totalTokens: d.totalTokens })),
  );
  expect(users.heaviestDays).toEqual(org.heaviestDays);
});

test("buildOverviewFromUsers: dailyActiveUsers counts distinct active emails per day, skipping inactive and email-less rows", () => {
  const userDays: UserDayRow[] = [
    userDayRow({ date: "2026-06-01", email: "a@x.com", chatMessages: 1 }),
    userDayRow({ date: "2026-06-01", email: "b@x.com" }), // zero activity -> not active
    userDayRow({ date: "2026-06-01", email: "", ccSessions: 1 }), // no email -> excluded
    userDayRow({ date: "2026-06-02", email: "a@x.com", webSearches: 2 }),
  ];
  const ov = buildOverviewFromUsers([], userDays);
  const byDate = new Map(ov.timeseries.map((d) => [d.date, d]));
  expect(byDate.get("2026-06-01")!.dailyActiveUsers).toBe(1);
  expect(byDate.get("2026-06-01")!.activeEmails).toEqual(["a@x.com"]);
  expect(byDate.get("2026-06-02")!.dailyActiveUsers).toBe(1);
});

test("buildOverview: heaviestDays are sorted by cost descending and capped at 10", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    orgProductRow({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, product: "chat", costCents: i + 1 }),
  );
  const ov = buildOverview([], rows);
  expect(ov.heaviestDays).toHaveLength(10);
  expect(ov.heaviestDays[0]!.costCents).toBe(12);
  expect(ov.heaviestDays.at(-1)!.costCents).toBe(3);
});

// ---- rankUsers ----

test("rankUsers: ranks by cost by default, joins CSV attributes, and skips rows with no email", () => {
  const attrs = new Map([["a@x.com", { Level: "Senior" }]]);
  const rows: UserProductRow[] = [
    userProductRow({ email: "a@x.com", product: "chat", costCents: 50, totalTokens: 10 }),
    userProductRow({ email: "a@x.com", product: "claude_code", costCents: 150, totalTokens: 5 }),
    userProductRow({ email: "b@x.com", product: "chat", costCents: 30, totalTokens: 100 }),
    userProductRow({ email: "", product: "chat", costCents: 999, totalTokens: 999 }),
  ];
  const ranked = rankUsers(rows, attrs);
  expect(ranked.map((u) => u.email)).toEqual(["a@x.com", "b@x.com"]);
  const a = ranked[0]!;
  expect(a.costCents).toBe(200);
  expect(a.attributes).toEqual({ Level: "Senior" });
  expect(a.costByProduct).toEqual({ chat: 50, claude_code: 150 });
});

test("rankUsers: by 'tokens' re-sorts by totalTokens instead of cost", () => {
  const rows: UserProductRow[] = [
    userProductRow({ email: "a@x.com", costCents: 200, totalTokens: 10 }),
    userProductRow({ email: "b@x.com", costCents: 10, totalTokens: 500 }),
  ];
  const ranked = rankUsers(rows, new Map(), { by: "tokens" });
  expect(ranked.map((u) => u.email)).toEqual(["b@x.com", "a@x.com"]);
});

test("rankUsers: limit caps the result length after sorting", () => {
  const rows: UserProductRow[] = [
    userProductRow({ email: "a@x.com", costCents: 300 }),
    userProductRow({ email: "b@x.com", costCents: 200 }),
    userProductRow({ email: "c@x.com", costCents: 100 }),
  ];
  const ranked = rankUsers(rows, new Map(), { limit: 2 });
  expect(ranked.map((u) => u.email)).toEqual(["a@x.com", "b@x.com"]);
});

// ---- summarizeMember ----

test("summarizeMember: matches case-insensitively, sums cost/tokens per day and in total, sorts daily by date", () => {
  const userProducts: UserProductRow[] = [
    userProductRow({ date: "2026-06-02", email: "a@x.com", product: "chat", costCents: 50, totalTokens: 10 }),
    userProductRow({ date: "2026-06-01", email: "a@x.com", product: "claude_code", costCents: 100, totalTokens: 20 }),
    userProductRow({ date: "2026-06-01", email: "other@x.com", product: "chat", costCents: 999 }),
  ];
  const summary = summarizeMember(userProducts, [], "A@X.com", { Level: "Senior" });
  expect(summary.email).toBe("a@x.com");
  expect(summary.totalCostCents).toBe(150);
  expect(summary.totalTokens).toBe(30);
  expect(summary.costByProduct).toEqual({ chat: 50, claude_code: 100 });
  expect(summary.daily.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02"]);
});

test("summarizeMember: activeDays only counts days with a non-zero activity metric", () => {
  const userDays: UserDayRow[] = [
    userDayRow({ date: "2026-06-01", email: "a@x.com", chatMessages: 2 }),
    userDayRow({ date: "2026-06-02", email: "a@x.com" }), // all-zero activity
  ];
  const summary = summarizeMember([], userDays, "a@x.com", null);
  expect(summary.activeDays).toBe(1);
  expect(summary.daily).toHaveLength(2); // still present, just not counted as active
});

// ---- aggregateByDimension ----

test("aggregateByDimension: thin wrapper delegates to aggregateByKeyer via a csvKeyer", () => {
  const attrs = new Map([["a@x.com", { Team: "Alpha" }]]);
  const rows: UserProductRow[] = [userProductRow({ email: "a@x.com", costCents: 100 })];
  const groups = aggregateByDimension(rows, [], attrs, "Team");
  expect(groups.map((g) => g.key)).toEqual(["Alpha"]);
  expect(groups[0]!.costCents).toBe(100);
});

// ---- aggregateByKeyerOverTime ----

test("aggregateByKeyerOverTime: buckets by date x key, and orders keys by total cost descending", () => {
  const attrs = new Map([
    ["a@x.com", { Team: "Alpha" }],
    ["b@x.com", { Team: "Beta" }],
  ]);
  const rows: UserProductRow[] = [
    userProductRow({ date: "2026-06-01", email: "a@x.com", costCents: 30, totalTokens: 5 }),
    userProductRow({ date: "2026-06-01", email: "b@x.com", costCents: 100, totalTokens: 5 }),
    userProductRow({ date: "2026-06-02", email: "a@x.com", costCents: 30, totalTokens: 5 }),
  ];
  const { rows: dayRows, keys } = aggregateByKeyerOverTime(rows, csvKeyer(attrs, "Team"));
  expect(keys).toEqual(["Beta", "Alpha"]); // Beta's 100 > Alpha's 60 total
  expect(dayRows).toEqual([
    { date: "2026-06-01", key: "Alpha", costCents: 30, totalTokens: 5 },
    { date: "2026-06-01", key: "Beta", costCents: 100, totalTokens: 5 },
    { date: "2026-06-02", key: "Alpha", costCents: 30, totalTokens: 5 },
  ]);
});

// ---- scaleUserProductRow / scaleUserDayRow ----

test("scaleUserProductRow: weight 1 returns the same object (no copy)", () => {
  const row = userProductRow({ costCents: 100 });
  expect(scaleUserProductRow(row, 1)).toBe(row);
});

test("scaleUserProductRow: scales every numeric metric by the weight", () => {
  const row = userProductRow({
    costCents: 100,
    totalTokens: 40,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 8,
    requests: 4,
  });
  const scaled = scaleUserProductRow(row, 0.5);
  expect(scaled).toEqual({
    ...row,
    costCents: 50,
    totalTokens: 20,
    inputTokens: 5,
    outputTokens: 10,
    cacheReadTokens: 4,
    requests: 2,
  });
});

test("scaleUserDayRow: weight 1 returns the same object (no copy)", () => {
  const row = userDayRow({ chatMessages: 4 });
  expect(scaleUserDayRow(row, 1)).toBe(row);
});

test("scaleUserDayRow: scales every numeric activity metric by the weight, leaving raw untouched", () => {
  const row = userDayRow({ chatMessages: 4, ccSessions: 2, webSearches: 6 });
  const scaled = scaleUserDayRow(row, 0.5);
  expect(scaled.chatMessages).toBe(2);
  expect(scaled.ccSessions).toBe(1);
  expect(scaled.webSearches).toBe(3);
  expect(scaled.raw).toBe(row.raw);
});
