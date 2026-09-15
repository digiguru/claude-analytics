import type { AttributeMap } from "./csv.js";
import { groupKey } from "./join.js";
import {
  activeMembershipShares,
  combinedKeptWeight,
  distinctFacetValues,
  resolveTimelineDimension,
  timelineDimensionId,
  type MembershipIndex,
  type TimelineFacet,
} from "./projects.js";
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
 * cross-facet proportional scaling — see applyTimelineFilterToKeyer). Merging
 * into one spec is also what lets {@link combinedKeptWeight} see correlated
 * hides (e.g. a project and its own team) together and discount them once,
 * not twice — a single spec is what it operates over.
 */
export function mergeFilterSpecs(
  a: FilterSpec | null | undefined,
  b: FilterSpec | null | undefined,
): FilterSpec | null {
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
 * A FilterSpec that hides every value of `facet` except `value` (including
 * UNASSIGNED_KEY, which {@link distinctFacetValues} always includes) — i.e.
 * "scope the data to this one project/team/client". Meant to be combined
 * with the active member filter via {@link mergeFilterSpecs} before a single
 * call to {@link applyTimelineFilterToKeyer} or {@link makeRowWeight}.
 */
export function timelineScopeSpec(index: MembershipIndex, facet: TimelineFacet, value: string): FilterSpec {
  const hidden = distinctFacetValues(index, facet).filter((v) => v !== value);
  return { hidden: { [timelineDimensionId(facet)]: hidden } };
}

/** timelineScopeSpec fixed to the "project" facet — kept for existing callers. */
export function projectScopeSpec(index: MembershipIndex, project: string): FilterSpec {
  return timelineScopeSpec(index, "project", project);
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
 * (e.g. two projects at 60/40), this is the combined kept fraction computed
 * ONCE over every hidden facet together (see {@link combinedKeptWeight}): hiding
 * one of two concurrent projects yields 0.4, not 0 — the other project's share
 * stays visible. Hiding that same project's team too still yields 0.4, not
 * 0.16 — project/team/client aren't independent, so a checkbox UI expressing
 * one exclusion in two correlated places must not discount it twice. Empty/no
 * filter, or nothing hidden on any timeline facet, returns a constant 1.
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
    return combinedKeptWeight(activeMembershipShares(index, email, date), timelineHidden);
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
 *    hiding a Project, or grouping by Project but hiding a Team): each
 *    surviving entry's weight is recomputed from the underlying membership
 *    shares that make it up, keeping only the shares that survive every OTHER
 *    hidden facet — so hiding a team correctly shaves out only the projects
 *    that belong to it, not every project uniformly, and hiding both a
 *    project and its own team doesn't discount that project's share twice.
 * A group-by with no timeline facet of its own (a CSV column, or `@cycle`) has
 * nothing to recompute per entry, so it's scaled by the day's one combined
 * kept fraction across every hidden timeline facet instead.
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
  const groupFacet = resolveTimelineDimension(groupFacetId);

  return (email: string, date: string) => {
    const entries = keyer(email, date);
    if (entries.length === 0) return entries;

    const sameFacetHidden = groupFacet && timelineHidden.find((h) => h.facet === groupFacet);
    const filtered = sameFacetHidden ? entries.filter((e) => !sameFacetHidden.set.has(e.key)) : entries;
    if (filtered.length === 0) return [];

    const otherHidden = timelineHidden.filter((h) => h.facet !== groupFacet);
    if (otherHidden.length === 0) return filtered;

    const shares = activeMembershipShares(index, email, date);
    if (!groupFacet) {
      const kept = combinedKeptWeight(shares, otherHidden);
      if (kept <= 0) return [];
      return kept < 1 ? filtered.map((e) => ({ key: e.key, weight: e.weight * kept })) : filtered;
    }

    // Recompute each surviving entry's weight from the membership shares
    // that make it up, so an "other facet" hide only removes the shares it
    // actually applies to rather than scaling every entry uniformly.
    return filtered
      .map((e) => ({
        key: e.key,
        weight: combinedKeptWeight(
          shares.filter((s) => s.facets[groupFacet] === e.key),
          otherHidden,
        ),
      }))
      .filter((e) => e.weight > 0);
  };
}
