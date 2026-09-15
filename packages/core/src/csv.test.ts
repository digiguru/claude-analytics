import { test, expect } from "vitest";
import { dimensionsOf, parseAttributesCsv } from "./csv.js";

test("parseAttributesCsv: parses email plus every other column as an attribute", () => {
  const { attributes, count, dimensions } = parseAttributesCsv("email,Role,Team\na@x.com,Engineer,Platform\n");
  expect(count).toBe(1);
  expect(dimensions).toEqual(["Role", "Team"]);
  expect(attributes.get("a@x.com")).toEqual({ Role: "Engineer", Team: "Platform" });
});

test("parseAttributesCsv: email matching is case-insensitive on lookup, values trimmed", () => {
  const { attributes } = parseAttributesCsv("email,Role\n  A@X.com  , Engineer \n");
  expect(attributes.get("a@x.com")).toEqual({ Role: "Engineer" });
});

test("parseAttributesCsv: no email column throws, naming the columns found", () => {
  expect(() => parseAttributesCsv("Role,Team\nEngineer,Platform\n")).toThrow(/missing an "email" column/);
});

test("parseAttributesCsv: empty input returns an empty result, no throw", () => {
  const { attributes, count, dimensions } = parseAttributesCsv("");
  expect(attributes.size).toBe(0);
  expect(count).toBe(0);
  expect(dimensions).toEqual([]);
});

// #30 item 14: a duplicate column name used to collapse silently (csv-parse
// builds each record keyed by column name, so the second "Role" column just
// overwrote the first's value with no indication anything was wrong).
test("parseAttributesCsv: a duplicate column name throws instead of silently collapsing", () => {
  expect(() => parseAttributesCsv("email,Role,Role\na@x.com,Engineer,Manager\n")).toThrow(
    /duplicate column name.*Role/,
  );
});

test("dimensionsOf: the distinct attribute keys across every user, sorted", () => {
  const { attributes } = parseAttributesCsv("email,Role,Team\na@x.com,Engineer,Platform\n");
  expect(dimensionsOf(attributes)).toEqual(["Role", "Team"]);
});
