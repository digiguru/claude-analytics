import { test, expect } from "vitest";
import { api, json, tokens, usd } from "./api.js";

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

test("usd: non-finite input renders a placeholder instead of $NaN", () => {
  expect(usd(NaN)).toBe("–");
  expect(usd(Infinity)).toBe("–");
  expect(usd(-Infinity)).toBe("–");
});

test("tokens: non-finite input renders a placeholder instead of NaN", () => {
  expect(tokens(NaN)).toBe("–");
  expect(tokens(Infinity)).toBe("–");
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

// ---- json() ----

test("json: parses a normal 2xx body", async () => {
  const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
  await expect(json<{ ok: boolean }>(res)).resolves.toEqual({ ok: true });
});

// #30 item 10: a 2xx with no body at all (e.g. 204 No Content) used to throw
// res.json()'s own opaque SyntaxError instead of a controlled result.
test("json: a 2xx with no body at all resolves to undefined instead of throwing", async () => {
  const res = new Response(null, { status: 204 });
  await expect(json(res)).resolves.toBeUndefined();
});

test("json: a non-2xx with a JSON error body throws that message", async () => {
  const res = new Response(JSON.stringify({ error: "nope" }), { status: 400 });
  await expect(json(res)).rejects.toThrow("nope");
});

test("json: a non-2xx with no parseable body falls back to a generic message", async () => {
  const res = new Response(null, { status: 500 });
  await expect(json(res)).rejects.toThrow("Request failed (500)");
});
