import { test, expect } from "vitest";
import { analyzeGaps, attributesFor, BLANK_KEY, groupKey, UNMATCHED_KEY } from "./join.js";
import type { AttributeMap } from "./csv.js";

function attrMap(entries: [string, Record<string, string>][]): AttributeMap {
  return new Map(entries);
}

test("groupKey: exact-case dimension match", () => {
  const attrs = attrMap([["a@x.com", { Level: "Senior" }]]);
  expect(groupKey(attrs, "a@x.com", "Level")).toBe("Senior");
});

test("groupKey: case-insensitive dimension match falls back when exact key is absent", () => {
  const attrs = attrMap([["a@x.com", { level: "Senior" }]]);
  expect(groupKey(attrs, "a@x.com", "Level")).toBe("Senior");
});

test("groupKey: email lookup is itself case-insensitive and trims whitespace", () => {
  const attrs = attrMap([["a@x.com", { Level: "Senior" }]]);
  expect(groupKey(attrs, "  A@X.com  ", "Level")).toBe("Senior");
});

test("groupKey: no CSV row at all for this email -> UNMATCHED_KEY", () => {
  const attrs = attrMap([["other@x.com", { Level: "Senior" }]]);
  expect(groupKey(attrs, "a@x.com", "Level")).toBe(UNMATCHED_KEY);
});

test("groupKey: CSV row exists but this column is empty for them -> BLANK_KEY", () => {
  const attrs = attrMap([["a@x.com", { Level: "" }]]);
  expect(groupKey(attrs, "a@x.com", "Level")).toBe(BLANK_KEY);
});

test("groupKey: CSV row exists but this column is missing entirely -> BLANK_KEY (fallback path)", () => {
  const attrs = attrMap([["a@x.com", { BU: "Platform" }]]);
  expect(groupKey(attrs, "a@x.com", "Level")).toBe(BLANK_KEY);
});

test("attributesFor: returns null when the email has no CSV row", () => {
  const attrs = attrMap([]);
  expect(attributesFor(attrs, "a@x.com")).toBe(null);
});

test("analyzeGaps: separates unmatched analytics emails from CSV-only emails", () => {
  const attrs = attrMap([
    ["in-both@x.com", { Level: "Senior" }],
    ["csv-only@x.com", { Level: "Junior" }],
  ]);
  const gaps = analyzeGaps(["in-both@x.com", "analytics-only@x.com", ""], attrs);
  expect(gaps.unmatchedEmails).toEqual(["analytics-only@x.com"]);
  expect(gaps.csvOnlyEmails).toEqual(["csv-only@x.com"]);
});
