import { aggregateByKeyer, groupsToCsv } from "@claude-analytics/core";
import { writeFileSync } from "node:fs";
import { resolveGroupByOrError } from "./groupBy.js";
import type { CliDeps, CommandResult } from "./types.js";

export interface ExportOpts {
  groupBy: string;
  out: string;
  from?: string;
  to?: string;
  product?: string;
}

export interface ExportDeps extends CliDeps {
  /** Injectable so tests don't touch the real filesystem; defaults to node:fs's writeFileSync. */
  writeFile?: (path: string, contents: string) => void;
}

export function runExport(deps: ExportDeps, opts: ExportOpts): CommandResult {
  const lines = [...deps.warnings];
  const resolved = resolveGroupByOrError(deps.attributes, deps.memberships, opts.groupBy);
  if ("error" in resolved) return { code: 1, lines: [...lines, resolved.error] };
  const { selector } = resolved;

  const groups = aggregateByKeyer(
    deps.db.getUserProducts({ from: opts.from, to: opts.to }),
    deps.db.getUserDays({ from: opts.from, to: opts.to }),
    selector.keyer,
    opts.product,
  );
  (deps.writeFile ?? writeFileSync)(opts.out, groupsToCsv(groups, selector.id));
  lines.push(`Wrote ${groups.length} group(s) to ${opts.out}.`);
  return { code: 0, lines };
}
