import { test, expect } from "vitest";
import { buildGroupColumns } from "./groupColumns.js";
import type { GroupRow } from "./api.js";

function row(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    key: "Acme",
    seats: 2,
    activeUsers: 1,
    activeUserDays: 3.5,
    costCents: 12345,
    totalTokens: 2_500_000,
    inputTokens: 0,
    outputTokens: 0,
    requests: 1,
    chatMessages: 1,
    ccSessions: 1,
    ccLocAdded: 1,
    ccCommits: 1,
    ccPrs: 1,
    coworkMessages: 1,
    webSearches: 1,
    costByProduct: {},
    avgCostPerSeat: 6172,
    avgCostPerActiveUser: 12345,
    avgTokensPerActiveUser: 2_500_000,
    ...overrides,
  };
}

test("buildGroupColumns: the Group column sorts alphabetically when not the Cycle dimension", () => {
  const columns = buildGroupColumns(false, new Map());
  const keyCol = columns.find((c) => c.key === "key")!;
  expect(keyCol.value(row({ key: "Zeta" }))).toBe("Zeta");
  expect(keyCol.render!(row({ key: "Zeta" }))).toBe("Zeta");
});

test("buildGroupColumns: the Group column sorts by cycle order when isCycleDimension is true", () => {
  const cycleOrder = new Map([
    ["Build", 1],
    ["Discovery", 0],
  ]);
  const columns = buildGroupColumns(true, cycleOrder);
  const keyCol = columns.find((c) => c.key === "key")!;
  expect(keyCol.value(row({ key: "Discovery" }))).toBe(0);
  expect(keyCol.value(row({ key: "Build" }))).toBe(1);
  expect(keyCol.value(row({ key: "Unknown" }))).toBe(Number.MAX_SAFE_INTEGER);
});

test("buildGroupColumns: money and token columns render formatted values", () => {
  const columns = buildGroupColumns(false, new Map());
  const costCol = columns.find((c) => c.key === "costCents")!;
  const tokensCol = columns.find((c) => c.key === "totalTokens")!;
  expect(costCol.render!(row({ costCents: 12345 }))).toBe("$123.45");
  expect(tokensCol.render!(row({ totalTokens: 2_500_000 }))).toBe("2.5M");
});

test("buildGroupColumns: activeUserDays renders to one decimal place", () => {
  const columns = buildGroupColumns(false, new Map());
  const col = columns.find((c) => c.key === "activeUserDays")!;
  expect(col.render!(row({ activeUserDays: 3 }))).toBe("3.0");
});

test("buildGroupColumns: covers every GroupRow metric column expected on the table", () => {
  const columns = buildGroupColumns(false, new Map());
  expect(columns.map((c) => c.key)).toEqual([
    "key",
    "seats",
    "activeUsers",
    "activeUserDays",
    "costCents",
    "avgCostPerSeat",
    "avgCostPerActiveUser",
    "totalTokens",
    "chatMessages",
    "ccSessions",
    "ccLocAdded",
    "coworkMessages",
    "webSearches",
  ]);
});

test("buildGroupColumns: every column's value() (and render(), where present) runs without throwing", () => {
  const columns = buildGroupColumns(false, new Map());
  const r = row();
  for (const col of columns) {
    expect(() => col.value(r)).not.toThrow();
    if (col.render) expect(() => col.render!(r)).not.toThrow();
  }
});
