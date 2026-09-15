import { test, expect } from "vitest";
import {
  EMAIL_FACET,
  hiddenCount,
  parseFilterSpec,
  parseFilterSpecJSON,
  userPasses,
  type FilterSpec,
} from "./filters.js";
import type { UserListEntry } from "./api.js";

function user(email: string, attrs: Record<string, string> = {}): UserListEntry {
  return { email, attributes: attrs };
}

// ---- parseFilterSpec (#17) ----

test("parseFilterSpec: a valid spec passes through unchanged", () => {
  const spec: FilterSpec = { hidden: { Team: ["Platform", "Enablement"] } };
  expect(parseFilterSpec(spec)).toEqual(spec);
});

test("parseFilterSpec: a string-valued facet (the #17 case) is dropped, not treated as a 1-char-per-includes array", () => {
  expect(parseFilterSpec({ hidden: { Team: "Platform" } })).toEqual({ hidden: {} });
});

test("parseFilterSpec: a non-array, non-string value (number, object) is dropped", () => {
  expect(parseFilterSpec({ hidden: { Team: 5, Level: { nested: true } } })).toEqual({ hidden: {} });
});

test("parseFilterSpec: a nested object in place of the whole spec is rejected", () => {
  expect(parseFilterSpec({ Team: ["Platform"] })).toBe(null); // no `hidden` key at all
  expect(parseFilterSpec({ hidden: ["Platform"] })).toBe(null); // hidden itself is an array, not a record
});

test("parseFilterSpec: hidden missing entirely, or the whole value not an object, is rejected", () => {
  expect(parseFilterSpec({})).toBe(null);
  expect(parseFilterSpec(null)).toBe(null);
  expect(parseFilterSpec("not an object")).toBe(null);
  expect(parseFilterSpec(["array", "not", "object"])).toBe(null);
});

test("parseFilterSpec: non-string entries within an array facet value are filtered out individually", () => {
  expect(parseFilterSpec({ hidden: { Team: ["Platform", 5, null, "Enablement"] } })).toEqual({
    hidden: { Team: ["Platform", "Enablement"] },
  });
});

test("parseFilterSpecJSON: malformed JSON falls back to null rather than throwing", () => {
  expect(parseFilterSpecJSON("{not json")).toBe(null);
});

test("parseFilterSpecJSON: a well-formed spec still works unchanged end to end", () => {
  expect(parseFilterSpecJSON('{"hidden":{"Team":["Platform"]}}')).toEqual({ hidden: { Team: ["Platform"] } });
});

// ---- hiddenCount can't return a string length ----

test("hiddenCount: counts array entries, not a string's character length", () => {
  expect(hiddenCount({ hidden: { Team: ["Platform", "Enablement"] } })).toBe(2);
  // A malformed spec (bypassing parseFilterSpec) must still not report a string length.
  expect(hiddenCount({ hidden: { Team: "Platform" as unknown as string[] } })).toBe(0);
});

// ---- userPasses hardening ----

test("userPasses: a string-valued hidden facet (bypassing parseFilterSpec) does not substring-match", () => {
  const spec = { hidden: { Team: "Pl" as unknown as string[] } };
  // Without the Array.isArray guard, "Pl" is a substring of "Platform" and would wrongly hide this user.
  expect(userPasses(spec, user("a@x.com", { Team: "Platform" }))).toBe(true);
});

test("userPasses: exact array matching still hides correctly", () => {
  const spec: FilterSpec = { hidden: { Team: ["Platform"] } };
  expect(userPasses(spec, user("a@x.com", { Team: "Platform" }))).toBe(false);
  expect(userPasses(spec, user("b@x.com", { Team: "Enablement" }))).toBe(true);
});

test("userPasses: EMAIL_FACET hide still works with a proper array", () => {
  const spec: FilterSpec = { hidden: { [EMAIL_FACET]: ["a@x.com"] } };
  expect(userPasses(spec, user("a@x.com"))).toBe(false);
  expect(userPasses(spec, user("b@x.com"))).toBe(true);
});
