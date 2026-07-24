// Client-side filter model. Mirrors the server's makeEmailFilter semantics so the
// member list filters identically to the aggregated views.
import type { Attributes, UserListEntry } from "./api.js";

/** Special facet for filtering on individual member emails. Matches core's EMAIL_FACET. */
export const EMAIL_FACET = "__email__";
export const UNMATCHED_KEY = "(unmatched)"; // not in CSV
export const BLANK_KEY = "(blank)"; // in CSV but empty for this column

/** Per facet (dimension name or EMAIL_FACET), the values switched OFF. */
export interface FilterSpec {
  hidden: Record<string, string[]>;
}

export interface SavedFilter {
  name: string;
  spec: FilterSpec;
}

export interface Facet {
  key: string; // dimension name or EMAIL_FACET
  label: string;
  values: string[]; // distinct, sorted
}

export const EMPTY_FILTER: FilterSpec = { hidden: {} };

export function isEmptyFilter(spec: FilterSpec | null | undefined): boolean {
  if (!spec || !spec.hidden) return true;
  return !Object.values(spec.hidden).some((v) => v && v.length > 0);
}

export function hiddenCount(spec: FilterSpec | null | undefined): number {
  if (!spec || !spec.hidden) return 0;
  return Object.values(spec.hidden).reduce((n, v) => n + (v?.length ?? 0), 0);
}

/** The group value of a user along a dimension — same rules as core's groupKey. */
export function valueFor(attrs: Attributes | null, dimension: string): string {
  if (!attrs) return UNMATCHED_KEY;
  if (attrs[dimension] !== undefined) return attrs[dimension] || BLANK_KEY;
  const want = dimension.toLowerCase();
  for (const [k, v] of Object.entries(attrs)) if (k.toLowerCase() === want) return v || BLANK_KEY;
  return BLANK_KEY;
}

/** Build the facet list (one per CSV dimension, plus a Member-email facet) from the user list. */
export function buildFacets(users: UserListEntry[], dimensions: string[]): Facet[] {
  const facets: Facet[] = dimensions.map((dim) => {
    const values = new Set<string>();
    for (const u of users) values.add(valueFor(u.attributes, dim));
    return { key: dim, label: dim, values: [...values].sort((a, b) => a.localeCompare(b)) };
  });
  facets.push({
    key: EMAIL_FACET,
    label: "Member (email)",
    values: users.map((u) => u.email).sort((a, b) => a.localeCompare(b)),
  });
  return facets;
}

/** Does a user pass the filter? (true = visible). Mirrors core's makeEmailFilter. */
export function userPasses(spec: FilterSpec | null | undefined, user: UserListEntry): boolean {
  if (isEmptyFilter(spec)) return true;
  const hidden = spec!.hidden;
  const emailHidden = hidden[EMAIL_FACET];
  if (emailHidden && emailHidden.includes(user.email)) return false;
  for (const [facet, values] of Object.entries(hidden)) {
    if (facet === EMAIL_FACET || !values?.length) continue;
    if (values.includes(valueFor(user.attributes, facet))) return false;
  }
  return true;
}

/** Toggle a single value's visibility within a facet, returning a new spec. */
export function toggleValue(spec: FilterSpec, facet: string, value: string): FilterSpec {
  const current = spec.hidden[facet] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const hidden = { ...spec.hidden };
  if (next.length) hidden[facet] = next;
  else delete hidden[facet];
  return { hidden };
}

/** Hide or show every value of a facet at once. */
export function setFacetAll(spec: FilterSpec, facet: string, allValues: string[], hideAll: boolean): FilterSpec {
  const hidden = { ...spec.hidden };
  if (hideAll) hidden[facet] = [...allValues];
  else delete hidden[facet];
  return { hidden };
}

/** JSON for the `filter` query param, or undefined when the filter is empty. */
export function filterToQuery(spec: FilterSpec | null | undefined): string | undefined {
  return isEmptyFilter(spec) ? undefined : JSON.stringify({ hidden: spec!.hidden });
}

// ---- local persistence ----

const SAVED_KEY = "claude-analytics:saved-filters";
const ACTIVE_KEY = "claude-analytics:active-filter";

export function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedFilter[];
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f.name === "string" && f.spec?.hidden) : [];
  } catch {
    return [];
  }
}

export function persistSavedFilters(filters: SavedFilter[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(filters));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function loadActiveFilter(): FilterSpec {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as FilterSpec;
      if (obj?.hidden && typeof obj.hidden === "object") return obj;
    }
  } catch {
    /* ignore */
  }
  return EMPTY_FILTER;
}

export function persistActiveFilter(spec: FilterSpec): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(spec));
  } catch {
    /* ignore */
  }
}
