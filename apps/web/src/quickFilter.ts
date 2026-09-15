// Pure helpers for the Groups page's "Quick filter by" control. Extracted
// from GroupsView (#29) so the facet-building, URL-value parsing, and
// project-scope inference are each independently testable.
import { buildFacets, EMAIL_FACET } from "./filters.js";
import type { TimelineDimension, UserListEntry } from "./api.js";

/** One "Quick filter by" choice: a facet (timeline or CSV) and its values.
 *  Timeline facets scope date-aware, via the server's `scope`/`scopeDimension`
 *  params; CSV facets are a plain member-filter hide-all-but-one, merged into
 *  the page's own `filter` query (see isolateValue/mergeFilterSpecs). */
export interface QuickFilterFacet {
  id: string;
  label: string;
  values: string[];
  kind: "timeline" | "csv";
}

export interface QuickFilter extends QuickFilterFacet {
  value: string;
}

/** Every facet "Quick filter by" can narrow to a single value of: the
 *  timeline facets (Project/Team/Client) and every CSV column, each with its
 *  distinct values. `unassignedKey` is filtered out of timeline facets — you
 *  can't "quick filter to Unassigned", only scope-out of a real project. */
export function buildQuickFilterFacets(
  timelineDimensions: TimelineDimension[],
  dimensions: string[],
  users: UserListEntry[],
  unassignedKey: string,
): QuickFilterFacet[] {
  const timeline: QuickFilterFacet[] = timelineDimensions.map((d) => ({
    id: d.id,
    label: d.label,
    values: d.values.filter((v) => v !== unassignedKey),
    kind: "timeline",
  }));
  const csv: QuickFilterFacet[] = buildFacets(users, dimensions)
    .filter((f) => f.key !== EMAIL_FACET)
    .map((f) => ({ id: f.key, label: f.label, values: f.values, kind: "csv" as const }));
  return [...timeline, ...csv];
}

/** Parse the `?qf=` URL value ("facetId::value") against the current facet
 *  list. Returns null for an empty/malformed value, or one that no longer
 *  resolves (e.g. the facet's value list changed since the URL was set). */
export function parseQuickFilter(qfRaw: string, facets: QuickFilterFacet[]): QuickFilter | null {
  const idx = qfRaw.indexOf("::");
  if (idx === -1) return null;
  const facetId = qfRaw.slice(0, idx);
  const value = qfRaw.slice(idx + 2);
  const facet = facets.find((f) => f.id === facetId);
  if (!facet || !facet.values.includes(value)) return null;
  return { ...facet, value };
}

/**
 * The project this chart is effectively scoped to, for Cycle purposes
 * (cycles are always project-specific): an explicit Quick-filter-by-Project
 * pick, else — regardless of what narrowed it (a Team/Client/CSV quick
 * filter, or the member filter) — whichever single project is the only one
 * left active. Never auto-selects Cycle granularity, only offers it.
 * `scopeIsInferred` distinguishes the two cases for the "Scoped to X" hint.
 */
export function resolveScopeProject(
  quickFilter: QuickFilter | null,
  activeProjects: string[],
): { scopeProject: string | null; scopeIsInferred: boolean } {
  const explicitProject = quickFilter?.kind === "timeline" && quickFilter.id === "@project" ? quickFilter.value : "";
  const scopeProject = explicitProject || (activeProjects.length === 1 ? activeProjects[0]! : null);
  return { scopeProject, scopeIsInferred: !explicitProject && Boolean(scopeProject) };
}
