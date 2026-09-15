import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";

// ============================================================================
// Temporal project/team/client groupings — a hand-editable YAML file that
// supplements the static attributes CSV with dated project assignments, so
// cost can be grouped (and charted over time) by Project/Team/Client even
// though a person may move between projects mid-range.
// ============================================================================

export type TimelineFacet = "project" | "team" | "client";
export const TIMELINE_FACETS: TimelineFacet[] = ["project", "team", "client"];

/** Group key used for a day with no active membership. */
export const UNASSIGNED_KEY = "Unassigned";
/** Group key for team/client when a project doesn't set one. */
export const NONE_KEY = "(none)";

/** Reserved dimension ids (as used in the Group By dropdown / API) for the timeline facets. */
const TIMELINE_DIMENSION_IDS: Record<TimelineFacet, string> = {
  project: "@project",
  team: "@team",
  client: "@client",
};
export const TIMELINE_DIMENSION_LABELS: Record<TimelineFacet, string> = {
  project: "Project",
  team: "Team",
  client: "Client",
};

/** Resolve a Group By id (e.g. "@project") to a timeline facet, or null. */
export function resolveTimelineDimension(input: string): TimelineFacet | null {
  const want = input.trim().toLowerCase();
  return TIMELINE_FACETS.find((f) => TIMELINE_DIMENSION_IDS[f] === want) ?? null;
}

export function timelineDimensionId(facet: TimelineFacet): string {
  return TIMELINE_DIMENSION_IDS[facet];
}

/** One person's window on one project, flattened out of the YAML's nested shape. */
export interface Membership {
  project: string;
  team: string; // NONE_KEY when the project set none
  client: string; // NONE_KEY when the project set none
  start: string; // YYYY-MM-DD, inclusive
  end: string | null; // YYYY-MM-DD inclusive, or null = open-ended
  allocation: number; // > 0; ratio between concurrent memberships, not an absolute share
}

/** email (lowercased, trimmed) -> memberships, sorted by start date. */
export type MembershipIndex = Map<string, Membership[]>;

export interface ProjectsParseResult {
  index: MembershipIndex;
  projectCount: number;
  memberCount: number;
  warnings: string[];
}

// ---- raw YAML shape ----
interface RawMember {
  email?: unknown;
  start?: unknown;
  end?: unknown;
  allocation?: unknown;
}
interface RawProject {
  name?: unknown;
  team?: unknown;
  client?: unknown;
  members?: unknown;
}
interface RawFile {
  projects?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Analytics is only available from this date onward — memberships entirely before it are moot. */
const API_FLOOR = "2026-01-01";

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Parse and validate a projects YAML file into a membership index. Throws only
 * on structural errors (not YAML, missing `projects`, a member with no email or
 * no start date); everything else that looks like a mistake is a warning.
 */
export function parseProjectsYaml(text: string): ProjectsParseResult {
  const doc = (parseYaml(text) ?? {}) as RawFile;
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.projects)) {
    throw new Error('Projects YAML must have a top-level "projects" list.');
  }

  const warnings: string[] = [];
  const index: MembershipIndex = new Map();
  const seenNames = new Set<string>();
  let projectCount = 0;
  let memberCount = 0;

  (doc.projects as RawProject[]).forEach((raw, projectIdx) => {
    if (typeof raw !== "object" || raw === null) {
      warnings.push(`Project #${projectIdx + 1}: not an object — skipped.`);
      return;
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      warnings.push(`Project #${projectIdx + 1}: missing "name" — skipped.`);
      return;
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      warnings.push(`Project "${name}": duplicate name — later entries for it are ignored.`);
      return;
    }
    seenNames.add(nameKey);
    projectCount += 1;

    const team = typeof raw.team === "string" && raw.team.trim() ? raw.team.trim() : NONE_KEY;
    const client = typeof raw.client === "string" && raw.client.trim() ? raw.client.trim() : NONE_KEY;
    const members = Array.isArray(raw.members) ? (raw.members as RawMember[]) : [];

    members.forEach((m, memberIdx) => {
      const who = `Project "${name}", member #${memberIdx + 1}`;
      if (typeof m !== "object" || m === null) {
        warnings.push(`${who}: not an object — skipped.`);
        return;
      }
      const email = typeof m.email === "string" ? m.email.trim().toLowerCase() : "";
      if (!email) {
        warnings.push(`${who}: missing "email" — skipped.`);
        return;
      }
      const start = typeof m.start === "string" ? m.start.trim() : "";
      if (!DATE_RE.test(start)) {
        warnings.push(`${who} (${email}): missing/invalid "start" date (want YYYY-MM-DD) — skipped.`);
        return;
      }
      let end: string | null = null;
      if (!isBlank(m.end)) {
        const endStr = String(m.end).trim();
        if (!DATE_RE.test(endStr)) {
          warnings.push(`${who} (${email}): invalid "end" date "${endStr}" — treated as open-ended.`);
        } else {
          end = endStr;
        }
      }
      if (end !== null && end < start) {
        warnings.push(`${who} (${email}): "end" (${end}) is before "start" (${start}) — skipped.`);
        return;
      }
      if ((end ?? "9999-99-99") < API_FLOOR) {
        warnings.push(`${who} (${email}): assignment ends before analytics data begins (${API_FLOOR}) — will never contribute cost.`);
      }

      let allocation = 1;
      if (!isBlank(m.allocation)) {
        const n = Number(m.allocation);
        if (!Number.isFinite(n) || n <= 0) {
          warnings.push(`${who} (${email}): invalid "allocation" (want a number > 0) — using 1.`);
        } else {
          allocation = n;
        }
      }

      const membership: Membership = { project: name, team, client, start, end, allocation };
      let list = index.get(email);
      if (!list) index.set(email, (list = []));
      list.push(membership);
      memberCount += 1;
    });
  });

  for (const list of index.values()) list.sort((a, b) => a.start.localeCompare(b.start));

  // Flag concurrent memberships with no explicit allocation split — they'll get an
  // even split, which is a reasonable default but worth calling out.
  for (const [email, list] of index) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        if (a.project === b.project) continue;
        const overlap = a.start <= (b.end ?? "9999-99-99") && b.start <= (a.end ?? "9999-99-99");
        if (overlap && a.allocation === 1 && b.allocation === 1) {
          warnings.push(
            `${email}: overlapping assignments to "${a.project}" and "${b.project}" with no "allocation" set — cost during the overlap will be split evenly.`,
          );
        }
      }
    }
  }

  return { index, projectCount, memberCount, warnings };
}

export function loadProjectsYaml(path: string): ProjectsParseResult {
  return parseProjectsYaml(readFileSync(path, "utf8"));
}

/**
 * Weighted group keys for one person on one day, for the given facet. Weights
 * are each membership's `allocation` normalised to sum to 1 across every
 * membership active that day (so a single active membership is always full
 * weight, however its `allocation` reads). No active membership -> Unassigned.
 * Memberships that collapse to the same key (e.g. two projects, one team)
 * have their weights merged so the key appears once.
 */
export function membershipKeys(
  index: MembershipIndex,
  email: string,
  date: string,
  facet: TimelineFacet,
): { key: string; weight: number }[] {
  const list = index.get(email.trim().toLowerCase());
  if (!list || list.length === 0) return [{ key: UNASSIGNED_KEY, weight: 1 }];

  const active = list.filter((m) => m.start <= date && (m.end === null || date <= m.end));
  if (active.length === 0) return [{ key: UNASSIGNED_KEY, weight: 1 }];

  const totalAllocation = active.reduce((s, m) => s + m.allocation, 0) || 1;
  const merged = new Map<string, number>();
  for (const m of active) {
    const key = m[facet];
    merged.set(key, (merged.get(key) ?? 0) + m.allocation / totalAllocation);
  }
  return [...merged.entries()].map(([key, weight]) => ({ key, weight }));
}

/** Distinct member emails, project/team/client facet values — for building UI facet lists. */
export function distinctFacetValues(index: MembershipIndex, facet: TimelineFacet): string[] {
  const values = new Set<string>([UNASSIGNED_KEY]);
  for (const list of index.values()) for (const m of list) values.add(m[facet]);
  return [...values].sort((a, b) => (a === UNASSIGNED_KEY ? -1 : b === UNASSIGNED_KEY ? 1 : a.localeCompare(b)));
}

/**
 * The facet values a person could have contributed to at any point in
 * [from, to] — an approximation used only to decide whether a person appears
 * in a *list of people* under a timeline filter (e.g. the Members tab), not
 * for any cost/money calculation (which uses {@link membershipKeys} per day
 * via {@link makeRowFilter} in filter.ts). Based on whether each membership's
 * window overlaps the range at all; does not account for day-by-day gaps
 * inside that window, so a person can show as "in" a project for a day they
 * were actually between assignments.
 */
export function activeFacetKeysInRange(
  index: MembershipIndex,
  email: string,
  from: string,
  to: string,
  facet: TimelineFacet,
): string[] {
  const list = index.get(email.trim().toLowerCase());
  if (!list || list.length === 0) return [UNASSIGNED_KEY];
  const overlapping = list.filter((m) => m.start <= to && (m.end === null || m.end >= from));
  if (overlapping.length === 0) return [UNASSIGNED_KEY];
  return [...new Set(overlapping.map((m) => m[facet]))].sort();
}
