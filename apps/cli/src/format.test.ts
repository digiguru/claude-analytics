import { test, expect } from "vitest";
import { attrLabel, formatDay, formatTable, ordinal, tk, usd } from "./format.js";

test("usd: cents to dollars, two decimals", () => {
  expect(usd(0)).toBe("$0.00");
  expect(usd(150)).toBe("$1.50");
  expect(usd(100000)).toBe("$1000.00");
});

test("tk: thousands/millions abbreviation, else the raw number", () => {
  expect(tk(999)).toBe("999");
  expect(tk(1500)).toBe("1.5k");
  expect(tk(2_500_000)).toBe("2.5M");
});

test("ordinal: 1st/2nd/3rd, 11th-13th special-cased, else nth", () => {
  expect(ordinal(1)).toBe("1st");
  expect(ordinal(2)).toBe("2nd");
  expect(ordinal(3)).toBe("3rd");
  expect(ordinal(4)).toBe("4th");
  expect(ordinal(11)).toBe("11th");
  expect(ordinal(12)).toBe("12th");
  expect(ordinal(13)).toBe("13th");
  expect(ordinal(21)).toBe("21st");
  expect(ordinal(101)).toBe("101st");
});

test("formatDay: ISO date to a short UTC weekday/day/month label", () => {
  expect(formatDay("2026-06-10")).toBe("Wed 10th Jun");
});

test("formatDay: an unparseable date is returned unchanged", () => {
  expect(formatDay("not-a-date")).toBe("not-a-date");
});

test("attrLabel: no CSV match vs no attributes vs a joined label", () => {
  expect(attrLabel(null)).toBe("no CSV match");
  expect(attrLabel({})).toBe("no attributes");
  expect(attrLabel({ Role: "  ", Team: "" })).toBe("no attributes");
  expect(attrLabel({ Role: "Engineer", Team: "Platform", Level: "3", Extra: "dropped" })).toBe(
    "Engineer · Platform · 3",
  );
});

test("formatTable: empty input yields no lines", () => {
  expect(formatTable([])).toEqual([]);
});

test("formatTable: header, rule, then one aligned row per entry", () => {
  const lines = formatTable([
    { name: "alice", cost: "$1.00" },
    { name: "bob", cost: "$12.50" },
  ]);
  expect(lines).toEqual(["name   cost  ", "-----  ------", "alice  $1.00 ", "bob    $12.50"]);
});
