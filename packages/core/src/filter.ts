import type { AttributeMap } from "./csv.js";
import { groupKey } from "./join.js";

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
