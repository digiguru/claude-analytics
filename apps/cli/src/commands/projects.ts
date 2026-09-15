import { cyclesFor, loadProjectsYaml, type ProjectsParseResult } from "@claude-analytics/core";
import { formatTable } from "../format.js";
import type { CommandResult } from "./types.js";

export interface ProjectsOpts {
  path: string | undefined;
  project?: string;
}

export interface ProjectsDeps {
  /** Injectable so tests can supply a fixture parse result without touching the real filesystem. */
  loadYaml?: (path: string) => ProjectsParseResult;
}

export function runProjects(deps: ProjectsDeps, opts: ProjectsOpts): CommandResult {
  if (!opts.path) {
    return { code: 0, lines: ["No projects file configured. Pass --projects <path> or set PROJECTS_PATH in .env."] };
  }
  const loadYaml = deps.loadYaml ?? loadProjectsYaml;
  let result: ProjectsParseResult;
  try {
    result = loadYaml(opts.path);
  } catch (err) {
    return { code: 1, lines: [`Failed to load ${opts.path}: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const { index, cycles, projectCount, memberCount, cycleCount, warnings } = result;
  if (projectCount === 0) {
    return { code: 0, lines: [`No projects found in ${opts.path}.`] };
  }

  // Flatten memberships back out by project for a per-project summary.
  const byProject = new Map<
    string,
    { team: string; client: string; members: number; start: string; end: string | null }
  >();
  for (const list of index.values()) {
    for (const m of list) {
      let p = byProject.get(m.project);
      if (!p)
        byProject.set(m.project, (p = { team: m.team, client: m.client, members: 0, start: m.start, end: m.end }));
      p.members += 1;
      if (m.start < p.start) p.start = m.start;
      if (p.end !== null && (m.end === null || m.end > p.end)) p.end = m.end;
    }
  }

  const lines: string[] = [
    "",
    `${opts.path}: ${projectCount} project(s), ${memberCount} membership(s), ${cycleCount} cycle(s).`,
    "",
    ...formatTable(
      [...byProject.entries()].map(([project, p]) => ({
        project,
        team: p.team,
        client: p.client,
        members: p.members,
        cycles: cycles.get(project)?.length ?? 0,
        from: p.start,
        to: p.end ?? "(ongoing)",
      })),
    ),
  ];

  if (cycleCount > 0) {
    const projectNames = opts.project ? [opts.project] : [...cycles.keys()];
    const rows = projectNames.flatMap((project) =>
      cyclesFor(cycles, project).map((c) => ({
        project,
        cycle: c.name,
        from: c.start,
        to: c.end === null ? "(ongoing)" : c.derivedEnd ? `${c.end} (→ next)` : c.end,
      })),
    );
    if (rows.length) {
      lines.push("", `Cycles${opts.project ? ` — ${opts.project}` : ""}:`, "", ...formatTable(rows));
    } else if (opts.project) {
      lines.push("", `No cycles found for "${opts.project}".`);
    }
  }

  if (warnings.length) {
    lines.push("", `${warnings.length} warning(s):`);
    for (const w of warnings) lines.push(`  - ${w}`);
  }

  return { code: 0, lines };
}
