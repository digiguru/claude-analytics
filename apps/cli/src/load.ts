// CSV/projects loading, separated from command logic (#37) so a load failure
// becomes data (a warning string) a caller can surface, rather than a direct
// console.error a test can't observe. See #30: these used to swallow load
// failures with a bare `catch { return new Map(); }` and no message at all.
import { loadAttributesCsv, loadProjectsYaml, type AttributeMap, type MembershipIndex } from "@claude-analytics/core";

export interface CsvLoadResult {
  attributes: AttributeMap;
  warning: string | null;
}

export interface ProjectsLoadResult {
  memberships: MembershipIndex;
  warning: string | null;
}

/** Load the attributes CSV, or an empty map with a warning when no path is
 *  configured or the file fails to load — attributes are optional, so this
 *  never fails the command, but the caller must still see why grouping by a
 *  CSV column silently found nothing. */
export function loadCsvOptional(path: string | undefined): CsvLoadResult {
  if (!path) return { attributes: new Map(), warning: null };
  try {
    return { attributes: loadAttributesCsv(path).attributes, warning: null };
  } catch (err) {
    return {
      attributes: new Map(),
      warning: `Failed to load CSV ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Load the projects/teams YAML, or an empty index with a warning when no
 *  path is configured or the file fails to load — projects are optional. */
export function loadProjectsOptional(path: string | undefined): ProjectsLoadResult {
  if (!path) return { memberships: new Map(), warning: null };
  try {
    return { memberships: loadProjectsYaml(path).index, warning: null };
  } catch (err) {
    return {
      memberships: new Map(),
      warning: `Failed to load projects file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
