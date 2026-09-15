import {
  resolveGroupBy as coreResolveGroupBy,
  type AttributeMap,
  type GroupSelector,
  type MembershipIndex,
} from "@claude-analytics/core";

/** Resolve --group-by against the shared core resolution order (timeline
 *  facets, then @member, then CSV columns), returning an error message
 *  instead of exiting — shared by the `group` and `export` commands. Per
 *  #28: this used to be an independently drifted copy of the server's
 *  version that didn't recognise @member at all; both apps now share one
 *  implementation and one set of supported values. */
export function resolveGroupByOrError(
  attributes: AttributeMap,
  memberships: MembershipIndex,
  value: string,
): { selector: GroupSelector } | { error: string } {
  const result = coreResolveGroupBy(attributes, memberships, value);
  if (result.ok) return { selector: result.selector };
  if (result.available.length === 0) {
    return {
      error: "No CSV attributes or projects file loaded. Pass --csv/--projects or set CSV_PATH/PROJECTS_PATH in .env.",
    };
  }
  return { error: `Invalid --group-by "${result.invalidValue}". Available: ${result.available.join(", ")}.` };
}
