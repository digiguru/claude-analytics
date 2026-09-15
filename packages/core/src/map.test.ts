import { test, expect } from "vitest";
import {
  chunkRange,
  dayAfter,
  enumerateDays,
  mergeOrgProducts,
  mergeUserProducts,
  nextDay,
  NO_EMAIL_KEY,
  parseCents,
  parseCentsChecked,
  prevDay,
} from "./map.js";
import { actor, costBucket, userCostRow, usageBucket, userUsageRow } from "./__fixtures__/index.js";

// ---- parseCents ----

test("parseCents: a normal integer-cents value", () => {
  expect(parseCents("1234")).toBe(1234);
});

test("parseCents: fractional cents", () => {
  expect(parseCents("1234.56")).toBe(1234.56);
});

test("parseCents: trailing garbage after the number is rejected, not silently truncated", () => {
  expect(parseCentsChecked("1234.56 USD")).toEqual({ cents: 0, ok: false });
  expect(parseCents("1234.56 USD")).toBe(0);
});

test("parseCents: null is rejected and reported", () => {
  expect(parseCentsChecked(null)).toEqual({ cents: 0, ok: false });
});

test("parseCents: undefined is rejected and reported", () => {
  expect(parseCentsChecked(undefined)).toEqual({ cents: 0, ok: false });
});

test("parseCents: empty string is rejected and reported", () => {
  expect(parseCentsChecked("")).toEqual({ cents: 0, ok: false });
  expect(parseCentsChecked("   ")).toEqual({ cents: 0, ok: false });
});

test("parseCents: a value large enough to risk precision loss still parses as a number", () => {
  const { cents, ok } = parseCentsChecked("9007199254740993.5");
  expect(ok).toBe(true);
  expect(cents).toBe(Number.parseFloat("9007199254740993.5"));
});

// ---- date range helpers ----

test("enumerateDays: inclusive list across a month boundary", () => {
  expect(enumerateDays("2026-01-30", "2026-02-02")).toEqual([
    "2026-01-30",
    "2026-01-31",
    "2026-02-01",
    "2026-02-02",
  ]);
});

test("enumerateDays: inclusive list across a year boundary", () => {
  expect(enumerateDays("2025-12-30", "2026-01-01")).toEqual(["2025-12-30", "2025-12-31", "2026-01-01"]);
});

test("enumerateDays: a leap day is included exactly once", () => {
  expect(enumerateDays("2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("enumerateDays: a single-day range returns that one day", () => {
  expect(enumerateDays("2026-06-01", "2026-06-01")).toEqual(["2026-06-01"]);
});

test("enumerateDays: throws on an invalid date string", () => {
  expect(() => enumerateDays("not-a-date", "2026-06-01")).toThrow(/Invalid date range/);
});

test("enumerateDays: throws when from is after to", () => {
  expect(() => enumerateDays("2026-06-02", "2026-06-01")).toThrow(/must not be after/);
});

test("chunkRange: splits into windows of at most maxDays", () => {
  const chunks = chunkRange("2026-01-01", "2026-01-05", 2);
  expect(chunks).toEqual([
    { from: "2026-01-01", to: "2026-01-02" },
    { from: "2026-01-03", to: "2026-01-04" },
    { from: "2026-01-05", to: "2026-01-05" },
  ]);
});

test("chunkRange: a range shorter than maxDays is a single chunk", () => {
  expect(chunkRange("2026-01-01", "2026-01-03", 31)).toEqual([{ from: "2026-01-01", to: "2026-01-03" }]);
});

test("nextDay / prevDay: month boundary", () => {
  expect(nextDay("2026-01-31")).toBe("2026-02-01");
  expect(prevDay("2026-02-01")).toBe("2026-01-31");
});

test("nextDay / prevDay: year boundary", () => {
  expect(nextDay("2025-12-31")).toBe("2026-01-01");
  expect(prevDay("2026-01-01")).toBe("2025-12-31");
});

test("nextDay: leap day", () => {
  expect(nextDay("2028-02-28")).toBe("2028-02-29");
  expect(nextDay("2028-02-29")).toBe("2028-03-01");
});

test("dayAfter: returns an RFC 3339 instant for the next calendar day", () => {
  expect(dayAfter("2026-01-31")).toBe("2026-02-01T00:00:00Z");
});

// ---- mergeUserProducts ----

test("mergeUserProducts: a cost row and a usage row for the same key merge into one row", () => {
  const { rows } = mergeUserProducts(
    [userCostRow({ amount: "150" })],
    [userUsageRow({ total_tokens: 40 })],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.costCents).toBe(150);
  expect(rows[0]!.totalTokens).toBe(40);
});

test("mergeUserProducts: key collision sums cost across multiple cost rows for the same date|user|product", () => {
  const { rows } = mergeUserProducts(
    [userCostRow({ amount: "100" }), userCostRow({ amount: "50" })],
    [],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.costCents).toBe(150);
});

test("mergeUserProducts: a null-email actor's spend is bucketed under NO_EMAIL_KEY, not dropped", () => {
  const { rows } = mergeUserProducts([userCostRow({ actor: actor({ email: null }), amount: "300" })], []);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.email).toBe(NO_EMAIL_KEY);
  expect(rows[0]!.costCents).toBe(300);
});

test("mergeUserProducts: a later usage row's real email backfills an earlier blank-email cost row for the same key", () => {
  const { rows } = mergeUserProducts(
    [userCostRow({ actor: actor({ email: null }), amount: "100" })],
    [userUsageRow({ actor: actor({ email: "real@x.com" }), total_tokens: 10 })],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.email).toBe("real@x.com");
  expect(rows[0]!.costCents).toBe(100);
  expect(rows[0]!.totalTokens).toBe(10);
});

test("mergeUserProducts: reports the count of unparseable cost amounts", () => {
  const { unparseableAmounts } = mergeUserProducts(
    [userCostRow({ amount: "not-a-number" }), userCostRow({ amount: "50" })],
    [],
  );
  expect(unparseableAmounts).toBe(1);
});

// ---- mergeOrgProducts ----

test("mergeOrgProducts: key collision sums cost across multiple buckets for the same date×product", () => {
  const { rows } = mergeOrgProducts(
    [costBucket("2026-06-01T00:00:00Z", [{ amount: "100" }]), costBucket("2026-06-01T00:00:00Z", [{ amount: "50" }])],
    [],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.costCents).toBe(150);
});

test("mergeOrgProducts: totalTokens includes both ephemeral cache_creation fields (fix for #15)", () => {
  const { rows } = mergeOrgProducts(
    [],
    [
      usageBucket("2026-06-01T00:00:00Z", [
        {
          uncached_input_tokens: 100,
          output_tokens: 200,
          cache_read_input_tokens: 10,
          cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 7 },
        },
      ]),
    ],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.totalTokens).toBe(100 + 200 + 10 + 5 + 7);
  expect(rows[0]!.cacheReadTokens).toBe(10);
});

test("mergeOrgProducts and mergeUserProducts agree on totalTokens for equivalent fixture data (fix for #15)", () => {
  const usage = {
    uncached_input_tokens: 100,
    output_tokens: 200,
    cache_read_input_tokens: 10,
    cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 7 },
  };
  const orgTotal = mergeOrgProducts([], [usageBucket("2026-06-01T00:00:00Z", [usage])]).rows[0]!.totalTokens;
  const userTotal = mergeUserProducts(
    [],
    [userUsageRow({ ...usage, total_tokens: 100 + 200 + 10 + 5 + 7 })],
  ).rows[0]!.totalTokens;
  expect(orgTotal).toBe(userTotal);
});

test("mergeOrgProducts: reports the count of unparseable cost amounts", () => {
  const { unparseableAmounts } = mergeOrgProducts(
    [costBucket("2026-06-01T00:00:00Z", [{ amount: "garbage" }, { amount: "50" }])],
    [],
  );
  expect(unparseableAmounts).toBe(1);
});
