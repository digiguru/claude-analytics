import type { AttributeMap } from "./csv.js";
import { groupKey } from "./join.js";
import { distinctFacetValues, membershipKeys, resolveTimelineDimension, timelineDimensionId, type MembershipIndex, type TimelineFacet } from "./projects.js";
import type { RowKeyer } from "./aggregate.js";

/** Special facet key for filtering on individual member emails (e.g. exclude a heavy user). */
export const EMAIL_FACET = "__email__";

/**
 * A member filter. For each facet (a CSV dimension name, or {@link EMAIL_FACET}),
 * `hidden` lists the values that are switched OFF. Everything starts visible;
 * unchecking a value adds it here. A facet absent from `hidden` (or with an empty
 * array) imposes no constraint.
 *
 * Semantics: a member passes the filter iff none of its facet values are hidden
 * (AND across facets). This models the checkbox UI: "only certain BUs" = uncheck
 * the others; "drop a heavy user" = uncheck that email.
 */
export interface FilterSpec {
  hidden: Record<string, string[]>;
}

export function isEmptyFilter(spec: FilterSpec | null | undefined): spec is null | undefined {
  if (!spec || !spec.hidden) return true;
  return !Object.values(spec.hidden).some((v) => Array.isArray(v) && v.length > 0);
}

/**
 * Build a predicate that returns true when an email is NOT hidden by the filter.
 * Empty/no filter accepts everything.
 */
export function makeEmailFilter(
  attributes: AttributeMap,
  spec: FilterSpec | null | undefined,
): (email: string) => boolean {
  if (isEmptyFilter(spec)) return () => true;

  const hidden = spec.hidden;
  const emailHidden = new Set((hidden[EMAIL_FACET] ?? []).map((e) => e.trim().toLowerCase()));
  const dimHidden: { dim: string; set: Set<string> }[] = [];
  for (const [facet, values] of Object.entries(hidden)) {
    if (facet === EMAIL_FACET) continue;
    // Timeline facets (@project/@team/@client) are date-aware and handled by
    // makeRowFilter below, not here — skip them so they aren't mistaken for CSV columns.
    if (resolveTimelineDimension(facet)) continue;
    if (Array.isArray(values) && values.length) dimHidden.push({ dim: facet, set: new Set(values) });
  }

  return (rawEmail: string) => {
    const email = (rawEmail ?? "").trim().toLowerCase();
    if (!email) return true; // unattributable rows can't be facet-matched; aggregation ignores them anyway
    if (emailHidden.has(email)) return false;
    for (const { dim, set } of dimHidden) {
      if (set.has(groupKey(attributes, email, dim))) return false;
    }
    return true;
  };
}

/**
 * Union two filter specs' hidden values per facet. Hides AND across facets (a
 * row must clear every facet to be visible), so unioning hidden sets intersects
 * what's visible — the correct way to combine, say, a member filter with a
 * separately-applied "scope to this project" constraint into one pass, rather
 * than wrapping a keyer/weight function twice (which would double-apply any
 * cross-facet proportional scaling — see applyTimelineFilterToKeyer).
 */
export function mergeFilterSpecs(a: FilterSpec | null | undefined, b: FilterSpec | null | undefined): FilterSpec | null {
  if (isEmptyFilter(a)) return b ?? null;
  if (isEmptyFilter(b)) return a ?? null;
  const hidden: Record<string, string[]> = {};
  for (const spec of [a, b]) {
    for (const [facet, values] of Object.entries(spec.hidden)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      hidden[facet] = [...new Set([...(hidden[facet] ?? []), ...values])];
    }
  }
  return { hidden };
}

/**
 * A FilterSpec that hides every project value except `project` (including
 * UNASSIGNED_KEY, which {@link distinctFacetValues} always includes) — i.e.
 * "scope the data to this one project". Meant to be combined with the active
 * member filter via {@link mergeFilterSpecs} before a single call to
 * {@link applyTimelineFilterToKeyer} or {@link makeRowWeight}.
 */
export function projectScopeSpec(index: MembershipIndex, project: string): FilterSpec {
  const hiddenProjects = distinctFacetValues(index, "project").filter((v) => v !== project);
  return { hidden: { [timelineDimensionId("project")]: hiddenProjects } };
}

/** Parse a JSON filter spec from a query param. Returns null when absent or invalid. */
export function parseFilterParam(raw: string | undefined): FilterSpec | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<FilterSpec>;
    if (obj && typeof obj === "object" && obj.hidden && typeof obj.hidden === "object") {
      return { hidden: obj.hidden as Record<string, string[]> };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Collect a spec's hidden values per timeline facet (project/team/client), skipping
 *  CSV/email facets and empty arrays. Shared by the two functions below. */
function timelineHiddenFacets(spec: FilterSpec): { facet: TimelineFacet; set: Set<string> }[] {
  const out: { facet: TimelineFacet; set: Set<string> }[] = [];
  for (const [facetId, values] of Object.entries(spec.hidden)) {
    const facet = resolveTimelineDimension(facetId);
    if (facet && Array.isArray(values) && values.length) out.push({ facet, set: new Set(values) });
  }
  return out;
}

/**
 * Build a per-row weight multiplier in [0, 1] reflecting a filter's hidden
 * timeline values, for contexts with no keyer to hide entries from (the org-style
 * overview, member exports) — see {@link scaleUserProductRow}/`scaleUserDayRow`
 * in aggregate.ts, which apply it. For a row split across concurrent memberships
 * (e.g. two projects at 60/40), this is the combined kept fraction across every
 * hidden facet: hiding one of two concurrent projects yields 0.4, not 0 — the
 * other project's share stays visible. Empty/no filter, or nothing hidden on
 * any timeline facet, returns a constant 1.
 */
export function makeRowWeight(
  index: MembershipIndex,
  spec: FilterSpec | null | undefined,
): (email: string, date: string) => number {
  if (isEmptyFilter(spec)) return () => 1;
  const timelineHidden = timelineHiddenFacets(spec);
  if (timelineHidden.length === 0) return () => 1;

  return (rawEmail: string, date: string) => {
    const email = (rawEmail ?? "").trim().toLowerCase();
    if (!email) return 1;
    let weight = 1;
    for (const { facet, set } of timelineHidden) {
      const keys = membershipKeys(index, email, date, facet);
      const kept = keys.filter((k) => !set.has(k.key)).reduce((s, k) => s + k.weight, 0);
      weight *= kept;
      if (weight <= 0) return 0;
    }
    return weight;
  };
}

/**
 * Wrap a Group By keyer so a filter's hidden timeline values are excluded from
 * its output, correctly for both:
 *  - hiding a value in the SAME facet as `groupFacetId` (e.g. grouping by
 *    Project and hiding one project): those entries are dropped outright, with
 *    no renormalization — a person split 60/40 across two projects, one hidden,
 *    keeps exactly the other's real 40% share rather than becoming 100%.
 *  - hiding a value in a DIFFERENT timeline facet (e.g. grouping by Team but
 *    hiding a Project, or grouping by Project but hiding a Team): every entry
 *    the keyer still emits is scaled by that day's kept fraction for the
 *    OTHER facet, so hiding a team also shaves its projects' cost out of a
 *    Project-grouped view, and vice versa.
 * CSV-facet hides aren't handled here — see {@link makeEmailFilter}.
 */
export function applyTimelineFilterToKeyer(
  keyer: RowKeyer,
  groupFacetId: string,
  index: MembershipIndex,
  spec: FilterSpec | null | undefined,
): RowKeyer {
  if (isEmptyFilter(spec)) return keyer;
  const timelineHidden = timelineHiddenFacets(spec);
  if (timelineHidden.length === 0) return keyer;

  return (email: string, date: string) => {
    let entries = keyer(email, date);
    for (const { facet, set } of timelineHidden) {
      if (entries.length === 0) break;
      if (timelineDimensionId(facet) === groupFacetId) {
        entries = entries.filter((e) => !set.has(e.key));
      } else {
        const otherKeys = membershipKeys(index, email, date, facet);
        const kept = otherKeys.filter((k) => !set.has(k.key)).reduce((s, k) => s + k.weight, 0);
        if (kept <= 0) return [];
        if (kept < 1) entries = entries.map((e) => ({ key: e.key, weight: e.weight * kept }));
      }
    }
    return entries;
  };
}
