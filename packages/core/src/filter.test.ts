import { test, expect } from "vitest";
import {
  applyTimelineFilterToKeyer,
  makeRowWeight,
  mergeFilterSpecs,
  projectScopeSpec,
  timelineScopeSpec,
  type FilterSpec,
} from "./filter.js";
import { csvKeyer, timelineKeyer, type RowKeyer } from "./aggregate.js";
import { parseProjectsYaml, UNASSIGNED_KEY } from "./projects.js";

// Two concurrent projects, 60/40, active 2026-03-01..2026-06-30 — the case that
// previously (before applyTimelineFilterToKeyer existed) caused a whole row to
// be dropped when only one of the two projects was hidden.
const YAML_SPLIT = `
projects:
  - name: Acme
    team: Platform
    members:
      - email: a@x.com
        start: 2026-03-01
        end: 2026-06-30
        allocation: 0.6
  - name: Globex
    team: Platform
    members:
      - email: a@x.com
        start: 2026-03-01
        end: 2026-06-30
        allocation: 0.4
`;

function loadIndex() {
  return parseProjectsYaml(YAML_SPLIT).index;
}

const DATE = "2026-04-01"; // inside both memberships' window

test("mergeFilterSpecs: empty + empty = empty", () => {
  expect(mergeFilterSpecs(null, null)).toBe(null);
});

test("mergeFilterSpecs: unions hidden arrays per facet without duplicates", () => {
  const a: FilterSpec = { hidden: { "@project": ["Acme"], Level: ["Junior"] } };
  const b: FilterSpec = { hidden: { "@project": ["Globex"], "@team": ["Enablement"] } };
  const merged = mergeFilterSpecs(a, b)!;
  expect(new Set(merged.hidden["@project"])).toEqual(new Set(["Acme", "Globex"]));
  expect(merged.hidden.Level).toEqual(["Junior"]);
  expect(merged.hidden["@team"]).toEqual(["Enablement"]);
});

test("projectScopeSpec hides every other project, including Unassigned", () => {
  const index = loadIndex();
  const spec = projectScopeSpec(index, "Acme");
  expect(spec.hidden["@project"]!.includes("Globex")).toBe(true);
  expect(spec.hidden["@project"]!.includes(UNASSIGNED_KEY)).toBe(true);
  expect(!spec.hidden["@project"]!.includes("Acme")).toBe(true);
});

test("timelineScopeSpec works for any facet, not just project (e.g. team)", () => {
  const index = loadIndex();
  const spec = timelineScopeSpec(index, "team", "Platform");
  // Both fixture projects (Acme, Globex) are on team "Platform", so no other
  // team value exists to hide besides Unassigned.
  expect(spec.hidden["@team"]).toEqual([UNASSIGNED_KEY]);
});

test("applyTimelineFilterToKeyer: same-facet hide drops matching entries with no renormalization", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "project");
  const spec: FilterSpec = { hidden: { "@project": ["Acme"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@project", index, spec);
  const entries = wrapped("a@x.com", DATE);
  expect(entries).toEqual([{ key: "Globex", weight: 0.4 }]); // real 40% share, not renormalized to 1
});

test("applyTimelineFilterToKeyer: cross-facet hide scales every emitted key by the kept fraction", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "team"); // both projects are team "Platform"
  const spec: FilterSpec = { hidden: { "@project": ["Acme"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@team", index, spec);
  const entries = wrapped("a@x.com", DATE);
  expect(entries).toEqual([{ key: "Platform", weight: 0.4 }]);
});

test("applyTimelineFilterToKeyer: hiding the shared team drops the row entirely, whatever the groupBy", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "project");
  const spec: FilterSpec = { hidden: { "@team": ["Platform"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@project", index, spec);
  expect(wrapped("a@x.com", DATE)).toEqual([]);
});

test("applyTimelineFilterToKeyer: project scope + a CSV group-by only shows the scoped share", () => {
  const index = loadIndex();
  const attrs = new Map([["a@x.com", { Level: "Senior" }]]);
  const keyer: RowKeyer = csvKeyer(attrs, "Level");
  const spec = projectScopeSpec(index, "Acme");
  const wrapped = applyTimelineFilterToKeyer(keyer, "Level", index, spec);
  expect(wrapped("a@x.com", DATE)).toEqual([{ key: "Senior", weight: 0.6 }]);
});

test("applyTimelineFilterToKeyer: merging scope with an unrelated user filter composes (no double scaling)", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "team");
  const scope = projectScopeSpec(index, "Acme"); // hides Globex + Unassigned
  const userFilter: FilterSpec = { hidden: { Level: ["Junior"] } }; // unrelated CSV facet
  const merged = mergeFilterSpecs(scope, userFilter)!;
  const wrapped = applyTimelineFilterToKeyer(keyer, "@team", index, merged);
  // Only @project is a timeline hide here, so weight should be exactly Acme's 0.6 share, once.
  expect(wrapped("a@x.com", DATE)).toEqual([{ key: "Platform", weight: 0.6 }]);
});

test("makeRowWeight: combined kept fraction across facets, hiding one of two concurrent projects", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { "@project": ["Acme"] } });
  expect(weightOf("a@x.com", DATE)).toBe(0.4);
});

test("makeRowWeight: hiding Unassigned only affects days with no active membership", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { "@project": [UNASSIGNED_KEY] } });
  expect(weightOf("a@x.com", DATE)).toBe(1); // has active memberships this day, unaffected
  expect(weightOf("a@x.com", "2026-01-15")).toBe(0); // before either membership starts -> Unassigned, hidden
});

test("makeRowWeight: no timeline facet hidden returns a constant 1", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { Level: ["Junior"] } });
  expect(weightOf("a@x.com", DATE)).toBe(1);
});
