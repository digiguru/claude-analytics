import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import type { Attributes } from "./types.js";

export type AttributeMap = Map<string, Attributes>;

export interface CsvParseResult {
  attributes: AttributeMap;
  count: number;
  /** Non-`email` column names (original casing, in header order) you can group by. */
  dimensions: string[];
}

/**
 * Parse CSV text into an email -> attributes map (email lowercased). Every
 * column other than `email` becomes a groupable dimension; header casing is
 * preserved. The only hard requirement is an `email` column to join on.
 */
export function parseAttributesCsv(text: string): CsvParseResult {
  const records = parse(text, {
    // A duplicate column name would otherwise silently collapse to its last
    // value per row (csv-parse builds each record as an object keyed by
    // these names) — thrown here, before any row is parsed, rather than
    // discovered later as quietly-wrong data. See #30 item 14.
    columns: (header: string[]) => {
      const trimmed = header.map((h) => h.trim());
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const h of trimmed) {
        if (seen.has(h)) dupes.add(h);
        else seen.add(h);
      }
      if (dupes.size > 0) {
        throw new Error(
          `CSV has duplicate column name(s): ${[...dupes].join(", ")}. Each column must be unique — rename or remove the duplicate.`,
        );
      }
      return trimmed;
    },
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return { attributes: new Map(), count: 0, dimensions: [] };
  }

  const headers = Object.keys(records[0]!);
  const emailHeader = headers.find((h) => h.toLowerCase() === "email");
  if (!emailHeader) {
    throw new Error(
      `CSV is missing an "email" column (needed to join to analytics). ` + `Found columns: ${headers.join(", ")}.`,
    );
  }
  const dimensions = headers.filter((h) => h !== emailHeader);

  const attributes: AttributeMap = new Map();
  for (const row of records) {
    const email = (row[emailHeader] ?? "").trim().toLowerCase();
    if (!email) continue;
    const attrs: Attributes = {};
    for (const dim of dimensions) attrs[dim] = (row[dim] ?? "").trim();
    attributes.set(email, attrs);
  }

  return { attributes, count: attributes.size, dimensions };
}

/** Read and parse an attributes CSV from disk. */
export function loadAttributesCsv(path: string): CsvParseResult {
  return parseAttributesCsv(readFileSync(path, "utf8"));
}

/**
 * Discover the groupable dimensions present across an attribute map (original
 * casing, sorted). Use when you only have the map and not the parse result.
 */
export function dimensionsOf(attributes: AttributeMap): string[] {
  const keys = new Set<string>();
  for (const attrs of attributes.values()) for (const k of Object.keys(attrs)) keys.add(k);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/** Resolve a user-supplied dimension name to its real (case-correct) key, or null. */
export function resolveDimension(attributes: AttributeMap, input: string): string | null {
  const want = input.trim().toLowerCase();
  return dimensionsOf(attributes).find((d) => d.toLowerCase() === want) ?? null;
}
