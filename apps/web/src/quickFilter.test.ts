import { test, expect } from "vitest";
import { buildQuickFilterFacets, parseQuickFilter, resolveScopeProject, type QuickFilterFacet } from "./quickFilter.js";
import type { TimelineDimension, UserListEntry } from "./api.js";

const UNASSIGNED = "Unassigned";

function tdim(id: string, label: string, values: string[]): TimelineDimension {
  return { id, label, values };
}

function user(email: string, attrs: Record<string, string> = {}): UserListEntry {
  return { email, attributes: attrs };
}

// ---- buildQuickFilterFacets ----

test("buildQuickFilterFacets: timeline facets drop the Unassigned value, CSV facets don't", () => {
  const facets = buildQuickFilterFacets(
    [tdim("@project", "Project", ["Acme", UNASSIGNED])],
    ["Level"],
    [user("a@x.com", { Level: "Senior" })],
    UNASSIGNED,
  );
  const project = facets.find((f) => f.id === "@project")!;
  expect(project.values).toEqual(["Acme"]);
  expect(project.kind).toBe("timeline");
  const level = facets.find((f) => f.id === "Level")!;
  expect(level.kind).toBe("csv");
});

test("buildQuickFilterFacets: the raw email facet is excluded (quick filter isn't for isolating one person)", () => {
  const facets = buildQuickFilterFacets([], [], [user("a@x.com")], UNASSIGNED);
  expect(facets.some((f) => f.id === "__email__")).toBe(false);
});

// ---- parseQuickFilter ----

const FACETS: QuickFilterFacet[] = [{ id: "Level", label: "Level", values: ["Senior", "Junior"], kind: "csv" }];

test("parseQuickFilter: a well-formed 'facetId::value' resolves against the facet list", () => {
  expect(parseQuickFilter("Level::Senior", FACETS)).toEqual({
    id: "Level",
    label: "Level",
    values: ["Senior", "Junior"],
    kind: "csv",
    value: "Senior",
  });
});

test("parseQuickFilter: empty/malformed input (no '::') returns null", () => {
  expect(parseQuickFilter("", FACETS)).toBe(null);
  expect(parseQuickFilter("Level", FACETS)).toBe(null);
});

test("parseQuickFilter: a facet that no longer exists returns null", () => {
  expect(parseQuickFilter("Bogus::x", FACETS)).toBe(null);
});

test("parseQuickFilter: a value no longer in the facet's list returns null (stale URL pick)", () => {
  expect(parseQuickFilter("Level::Retired", FACETS)).toBe(null);
});

// ---- resolveScopeProject ----

test("resolveScopeProject: an explicit @project quick filter wins, and isn't 'inferred'", () => {
  const qf = { id: "@project", label: "Project", values: ["Acme"], kind: "timeline" as const, value: "Acme" };
  expect(resolveScopeProject(qf, ["Acme", "Globex"])).toEqual({ scopeProject: "Acme", scopeIsInferred: false });
});

test("resolveScopeProject: no explicit project, but exactly one active project -> inferred scope", () => {
  expect(resolveScopeProject(null, ["Acme"])).toEqual({ scopeProject: "Acme", scopeIsInferred: true });
});

test("resolveScopeProject: more than one active project -> no scope at all", () => {
  expect(resolveScopeProject(null, ["Acme", "Globex"])).toEqual({ scopeProject: null, scopeIsInferred: false });
});

test("resolveScopeProject: a non-project quick filter (e.g. Team) doesn't count as explicit project scope", () => {
  const qf = { id: "@team", label: "Team", values: ["Platform"], kind: "timeline" as const, value: "Platform" };
  expect(resolveScopeProject(qf, ["Acme"])).toEqual({ scopeProject: "Acme", scopeIsInferred: true });
});

test("resolveScopeProject: no active projects at all -> no scope", () => {
  expect(resolveScopeProject(null, [])).toEqual({ scopeProject: null, scopeIsInferred: false });
});
