import { test, expect } from "vitest";
import {
  BLANK_KEY,
  buildFacets,
  EMAIL_FACET,
  filterToQuery,
  hiddenCount,
  isEmptyFilter,
  isolateValue,
  mergeFilterSpecs,
  parseFilterSpec,
  parseFilterSpecJSON,
  setFacetAll,
  toggleValue,
  UNMATCHED_KEY,
  userPasses,
  valueFor,
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

test("userPasses: an @-facet (timeline) hide only excludes a user when EVERY overlapping group is hidden", () => {
  const spec: FilterSpec = { hidden: { "@project": ["Acme"] } };
  const soleGroup: UserListEntry = { email: "a@x.com", attributes: {}, groups: { "@project": ["Acme"] } };
  const splitGroups: UserListEntry = { email: "b@x.com", attributes: {}, groups: { "@project": ["Acme", "Globex"] } };
  expect(userPasses(spec, soleGroup)).toBe(false); // only group is hidden -> excluded
  expect(userPasses(spec, splitGroups)).toBe(true); // still has a visible group -> included
});

// ---- isEmptyFilter ----

test("isEmptyFilter: null/undefined and an all-empty hidden map are empty", () => {
  expect(isEmptyFilter(null)).toBe(true);
  expect(isEmptyFilter(undefined)).toBe(true);
  expect(isEmptyFilter({ hidden: {} })).toBe(true);
  expect(isEmptyFilter({ hidden: { Team: [] } })).toBe(true);
});

test("isEmptyFilter: any non-empty hidden array makes it non-empty", () => {
  expect(isEmptyFilter({ hidden: { Team: ["Platform"] } })).toBe(false);
});

// ---- valueFor ----

test("valueFor: no attributes at all -> UNMATCHED_KEY", () => {
  expect(valueFor(null, "Level")).toBe(UNMATCHED_KEY);
});

test("valueFor: an exact-case column match", () => {
  expect(valueFor({ Level: "Senior" }, "Level")).toBe("Senior");
});

test("valueFor: case-insensitive column match when exact case is absent", () => {
  expect(valueFor({ level: "Senior" }, "Level")).toBe("Senior");
});

test("valueFor: an empty value for a present column -> BLANK_KEY", () => {
  expect(valueFor({ Level: "" }, "Level")).toBe(BLANK_KEY);
});

test("valueFor: the column doesn't exist at all -> BLANK_KEY", () => {
  expect(valueFor({ Other: "x" }, "Level")).toBe(BLANK_KEY);
});

// ---- buildFacets ----

test("buildFacets: builds one facet per CSV dimension plus timeline and Member facets", () => {
  const users: UserListEntry[] = [
    { email: "b@x.com", attributes: { Level: "Senior" } },
    { email: "a@x.com", attributes: { Level: "Junior" } },
  ];
  const facets = buildFacets(users, ["Level"], [{ id: "@project", label: "Project", values: ["Acme", "Unassigned"] }]);
  const byKey = new Map(facets.map((f) => [f.key, f]));
  expect(byKey.get("Level")!.values).toEqual(["Junior", "Senior"]); // sorted
  expect(byKey.get("@project")!.values).toEqual(["Acme", "Unassigned"]); // passed through as-is
  expect(byKey.get(EMAIL_FACET)!.values).toEqual(["a@x.com", "b@x.com"]); // sorted
});

// ---- toggleValue / setFacetAll / isolateValue / mergeFilterSpecs / filterToQuery ----

test("toggleValue: adds a value to hidden, then removes it again", () => {
  let spec: FilterSpec = { hidden: {} };
  spec = toggleValue(spec, "Team", "Platform");
  expect(spec.hidden.Team).toEqual(["Platform"]);
  spec = toggleValue(spec, "Team", "Platform");
  expect(spec.hidden.Team).toBeUndefined(); // facet key removed once empty, not left as []
});

test("setFacetAll: hides every given value, or clears the facet entirely", () => {
  let spec: FilterSpec = { hidden: {} };
  spec = setFacetAll(spec, "Team", ["Platform", "Enablement"], true);
  expect(spec.hidden.Team).toEqual(["Platform", "Enablement"]);
  spec = setFacetAll(spec, "Team", ["Platform", "Enablement"], false);
  expect(spec.hidden.Team).toBeUndefined();
});

test("isolateValue: hides every value in the facet except the one given", () => {
  const spec = isolateValue("Team", ["Platform", "Enablement", "Growth"], "Enablement");
  expect(new Set(spec.hidden.Team)).toEqual(new Set(["Platform", "Growth"]));
});

test("mergeFilterSpecs: unions hidden arrays per facet, de-duplicated", () => {
  const a: FilterSpec = { hidden: { Team: ["Platform"] } };
  const b: FilterSpec = { hidden: { Team: ["Platform", "Enablement"], Level: ["Junior"] } };
  const merged = mergeFilterSpecs(a, b)!;
  expect(new Set(merged.hidden.Team)).toEqual(new Set(["Platform", "Enablement"]));
  expect(merged.hidden.Level).toEqual(["Junior"]);
});

test("mergeFilterSpecs: an empty side just returns the other side unchanged", () => {
  const a: FilterSpec = { hidden: { Team: ["Platform"] } };
  expect(mergeFilterSpecs(a, null)).toBe(a);
  expect(mergeFilterSpecs(null, a)).toBe(a);
  expect(mergeFilterSpecs(null, null)).toBe(null);
});

test("filterToQuery: undefined for an empty filter, JSON otherwise", () => {
  expect(filterToQuery({ hidden: {} })).toBeUndefined();
  expect(filterToQuery({ hidden: { Team: ["Platform"] } })).toBe('{"hidden":{"Team":["Platform"]}}');
});
