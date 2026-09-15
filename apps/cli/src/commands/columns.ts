import {
  dimensionsOf,
  MEMBER_DIMENSION_ID,
  TIMELINE_DIMENSION_LABELS,
  TIMELINE_FACETS,
  timelineDimensionId,
} from "@claude-analytics/core";
import type { CliDeps, CommandResult } from "./types.js";

export function runColumns(deps: CliDeps): CommandResult {
  const lines = [...deps.warnings];
  const dims = dimensionsOf(deps.attributes);
  if (deps.memberships.size) {
    lines.push("", "Timeline (from your projects file):", "");
    for (const facet of TIMELINE_FACETS) {
      lines.push(`  - ${timelineDimensionId(facet)}  (${TIMELINE_DIMENSION_LABELS[facet]})`);
    }
  }
  lines.push("", `  - ${MEMBER_DIMENSION_ID}  (Member — always available, groups by raw email)`);
  if (dims.length === 0 && deps.memberships.size === 0) {
    lines.push(
      "",
      "No CSV attributes or projects file loaded. Pass --csv/--projects or set CSV_PATH/PROJECTS_PATH in .env.",
    );
    return { code: 0, lines };
  }
  if (dims.length) {
    lines.push("", `${deps.attributes.size} developer row(s). Group by any CSV column:`, "");
    for (const d of dims) lines.push(`  - ${d}`);
  }
  const example = deps.memberships.size ? timelineDimensionId("project") : (dims[0] ?? MEMBER_DIMENSION_ID);
  lines.push("", `e.g. npm run cli -- group --group-by ${example}`);
  return { code: 0, lines };
}
