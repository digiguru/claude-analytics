import type { AttributeMap } from "./csv.js";
import type { Attributes } from "./types.js";

export const UNMATCHED_KEY = "(unmatched)";
/** In the CSV, but this column is empty for them — distinct from having no CSV row at all. */
export const BLANK_KEY = "(blank)";

/** Attributes for an email, or null if not in the CSV. */
export function attributesFor(attributes: AttributeMap, email: string): Attributes | null {
  return attributes.get(email.trim().toLowerCase()) ?? null;
}

/** The group key for an email along a dimension ("(unmatched)" when no CSV row). */
export function groupKey(attributes: AttributeMap, email: string, dimension: string): string {
  const attrs = attributesFor(attributes, email);
  if (!attrs) return UNMATCHED_KEY;
  // Exact key first; fall back to case-insensitive match so "level" finds "Level".
  if (attrs[dimension] !== undefined) return attrs[dimension] || BLANK_KEY;
  const want = dimension.toLowerCase();
  for (const [k, v] of Object.entries(attrs)) if (k.toLowerCase() === want) return v || BLANK_KEY;
  return BLANK_KEY;
}

export interface JoinGaps {
  /** Emails seen in analytics but absent from the CSV. */
  unmatchedEmails: string[];
  /** Emails in the CSV with no analytics activity in range. */
  csvOnlyEmails: string[];
}

export function analyzeGaps(analyticsEmails: Iterable<string>, attributes: AttributeMap): JoinGaps {
  const seen = new Set<string>();
  const unmatched = new Set<string>();
  for (const raw of analyticsEmails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    seen.add(email);
    if (!attributes.has(email)) unmatched.add(email);
  }
  const csvOnly: string[] = [];
  for (const email of attributes.keys()) if (!seen.has(email)) csvOnly.push(email);
  return { unmatchedEmails: [...unmatched].sort(), csvOnlyEmails: csvOnly.sort() };
}
