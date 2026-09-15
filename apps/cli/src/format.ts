// Pure, injection-free formatting helpers — extracted from index.ts (#37) so
// they're directly unit-testable with no commander/process/console involved.
import type { Attributes } from "@claude-analytics/core";

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const tk = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "2026-06-10" -> "Wed 10th Jun" (UTC). */
export function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${WEEKDAYS[d.getUTCDay()]} ${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

/** A short human label from whatever attributes a CSV happens to carry. */
export function attrLabel(a: Attributes | null): string {
  if (!a) return "no CSV match";
  const vals = Object.values(a).filter((v) => v && v.trim());
  return vals.length ? vals.slice(0, 3).join(" · ") : "no attributes";
}

/**
 * A simple aligned-column text table (header, a `-`-rule, then one row per
 * entry) — replaces `console.table` so command output is plain `string[]`
 * lines a test can assert on directly, rather than whatever `console.table`
 * happens to write to stdout.
 */
export function formatTable(rows: Record<string, string | number>[]): string[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]!);
  const cells = rows.map((r) => cols.map((c) => String(r[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i]!.length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)];
}
