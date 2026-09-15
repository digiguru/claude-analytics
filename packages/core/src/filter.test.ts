import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(mergeFilterSpecs(null, null), null);
});

test("mergeFilterSpecs: unions hidden arrays per facet without duplicates", () => {
  const a: FilterSpec = { hidden: { "@project": ["Acme"], Level: ["Junior"] } };
  const b: FilterSpec = { hidden: { "@project": ["Globex"], "@team": ["Enablement"] } };
  const merged = mergeFilterSpecs(a, b)!;
  assert.deepEqual(new Set(merged.hidden["@project"]), new Set(["Acme", "Globex"]));
  assert.deepEqual(merged.hidden.Level, ["Junior"]);
  assert.deepEqual(merged.hidden["@team"], ["Enablement"]);
});

test("projectScopeSpec hides every other project, including Unassigned", () => {
  const index = loadIndex();
  const spec = projectScopeSpec(index, "Acme");
  assert.ok(spec.hidden["@project"]!.includes("Globex"));
  assert.ok(spec.hidden["@project"]!.includes(UNASSIGNED_KEY));
  assert.ok(!spec.hidden["@project"]!.includes("Acme"));
});

test("timelineScopeSpec works for any facet, not just project (e.g. team)", () => {
  const index = loadIndex();
  const spec = timelineScopeSpec(index, "team", "Platform");
  // Both fixture projects (Acme, Globex) are on team "Platform", so no other
  // team value exists to hide besides Unassigned.
  assert.deepEqual(spec.hidden["@team"], [UNASSIGNED_KEY]);
});

test("applyTimelineFilterToKeyer: same-facet hide drops matching entries with no renormalization", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "project");
  const spec: FilterSpec = { hidden: { "@project": ["Acme"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@project", index, spec);
  const entries = wrapped("a@x.com", DATE);
  assert.deepEqual(entries, [{ key: "Globex", weight: 0.4 }]); // real 40% share, not renormalized to 1
});

test("applyTimelineFilterToKeyer: cross-facet hide scales every emitted key by the kept fraction", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "team"); // both projects are team "Platform"
  const spec: FilterSpec = { hidden: { "@project": ["Acme"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@team", index, spec);
  const entries = wrapped("a@x.com", DATE);
  assert.deepEqual(entries, [{ key: "Platform", weight: 0.4 }]);
});

test("applyTimelineFilterToKeyer: hiding the shared team drops the row entirely, whatever the groupBy", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "project");
  const spec: FilterSpec = { hidden: { "@team": ["Platform"] } };
  const wrapped = applyTimelineFilterToKeyer(keyer, "@project", index, spec);
  assert.deepEqual(wrapped("a@x.com", DATE), []);
});

test("applyTimelineFilterToKeyer: project scope + a CSV group-by only shows the scoped share", () => {
  const index = loadIndex();
  const attrs = new Map([["a@x.com", { Level: "Senior" }]]);
  const keyer: RowKeyer = csvKeyer(attrs, "Level");
  const spec = projectScopeSpec(index, "Acme");
  const wrapped = applyTimelineFilterToKeyer(keyer, "Level", index, spec);
  assert.deepEqual(wrapped("a@x.com", DATE), [{ key: "Senior", weight: 0.6 }]);
});

test("applyTimelineFilterToKeyer: merging scope with an unrelated user filter composes (no double scaling)", () => {
  const index = loadIndex();
  const keyer: RowKeyer = timelineKeyer(index, "team");
  const scope = projectScopeSpec(index, "Acme"); // hides Globex + Unassigned
  const userFilter: FilterSpec = { hidden: { Level: ["Junior"] } }; // unrelated CSV facet
  const merged = mergeFilterSpecs(scope, userFilter)!;
  const wrapped = applyTimelineFilterToKeyer(keyer, "@team", index, merged);
  // Only @project is a timeline hide here, so weight should be exactly Acme's 0.6 share, once.
  assert.deepEqual(wrapped("a@x.com", DATE), [{ key: "Platform", weight: 0.6 }]);
});

test("makeRowWeight: combined kept fraction across facets, hiding one of two concurrent projects", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { "@project": ["Acme"] } });
  assert.equal(weightOf("a@x.com", DATE), 0.4);
});

test("makeRowWeight: hiding Unassigned only affects days with no active membership", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { "@project": [UNASSIGNED_KEY] } });
  assert.equal(weightOf("a@x.com", DATE), 1); // has active memberships this day, unaffected
  assert.equal(weightOf("a@x.com", "2026-01-15"), 0); // before either membership starts -> Unassigned, hidden
});

test("makeRowWeight: no timeline facet hidden returns a constant 1", () => {
  const index = loadIndex();
  const weightOf = makeRowWeight(index, { hidden: { Level: ["Junior"] } });
  assert.equal(weightOf("a@x.com", DATE), 1);
});
