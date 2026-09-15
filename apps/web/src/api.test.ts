import { test, expect } from "vitest";
import { api, tokens, usd } from "./api.js";

// ---- formatters ----

test("usd: formats cents as a dollar string with 2 decimals", () => {
  expect(usd(12345)).toBe("$123.45");
  expect(usd(0)).toBe("$0.00");
});

test("tokens: abbreviates millions/thousands, leaves small numbers as-is", () => {
  expect(tokens(2_500_000)).toBe("2.5M");
  expect(tokens(2_500)).toBe("2.5k");
  expect(tokens(500)).toBe("500");
});

// ---- pure URL builders (no network involved) ----

test("exportUrl: builds a query string from the given fields, omitting undefined ones", () => {
  const url = api.exportUrl({ dimension: "@project", from: "2026-06-01", to: "2026-06-30" });
  expect(url).toBe("/api/export?groupBy=%40project&from=2026-06-01&to=2026-06-30");
});

test("exportUrl: with nothing set, has no query string at all", () => {
  expect(api.exportUrl({ dimension: "" })).toBe("/api/export");
});

test("exportGroupsDailyUrl: same query shape, different path", () => {
  const url = api.exportGroupsDailyUrl({ dimension: "Level", product: "chat" });
  expect(url).toBe("/api/export/groups-daily?groupBy=Level&product=chat");
});

test("exportMembersUrl / exportMembersLongUrl: build from from/to/filter only", () => {
  expect(api.exportMembersUrl("2026-06-01", "2026-06-30")).toBe("/api/export/members?from=2026-06-01&to=2026-06-30");
  expect(api.exportMembersLongUrl(undefined, undefined, '{"hidden":{}}')).toBe(
    `/api/export/members-long?filter=${encodeURIComponent('{"hidden":{}}')}`,
  );
});
