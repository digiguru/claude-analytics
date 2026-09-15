import type { AttributeMap, MembershipIndex, MetricsDb } from "@claude-analytics/core";

/** What a command function returns: the lines it wants printed, and the
 *  process exit code. `index.ts` prints `lines` and calls `process.exit(code)`
 *  — no command function calls `console.*` or `process.exit` itself (#37). */
export interface CommandResult {
  code: number;
  lines: string[];
}

/** Shared dependencies for every command that reads cached metrics and/or CSV
 *  attributes and project memberships. Built once in index.ts from real
 *  files/DB; tests construct one directly against an in-memory MetricsDb, no
 *  subprocess or real filesystem required. `warnings` carries any non-fatal
 *  CSV/projects load failures (see load.ts) so a command can surface them as
 *  the first output line(s) rather than swallowing them (#30). */
export interface CliDeps {
  db: MetricsDb;
  attributes: AttributeMap;
  memberships: MembershipIndex;
  warnings: string[];
}
