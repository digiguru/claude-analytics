import "dotenv/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  loadAttributesCsv,
  loadProjectsYaml,
  MetricsDb,
  type AttributeMap,
  type CycleIndex,
  type MembershipIndex,
  type ProjectsParseResult,
} from "@claude-analytics/core";

export interface ServerConfig {
  apiKey: string;
  dbPath: string;
  csvPath?: string;
  projectsPath?: string;
  port: number;
}

export function loadConfig(): ServerConfig {
  const portRaw = process.env.PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${portRaw}" — must be an integer between 0 and 65535.`);
  }
  return {
    apiKey: process.env.ANTHROPIC_ANALYTICS_API_KEY ?? process.env.ANTHROPIC_ADMIN_API_KEY ?? "",
    dbPath: resolve(process.env.DB_PATH ?? "./data/analytics.db"),
    csvPath: process.env.CSV_PATH ? resolve(process.env.CSV_PATH) : undefined,
    projectsPath: resolve(process.env.PROJECTS_PATH ?? "./config/projects.yaml"),
    port,
  };
}

/** Mutable server state: the DB handle plus the active attributes CSV and projects file. */
export class AppState {
  readonly config: ServerConfig;
  readonly db: MetricsDb;
  attributes: AttributeMap = new Map();
  csvSource: string | null = null; // describes where the active CSV came from
  memberships: MembershipIndex = new Map();
  cycles: CycleIndex = new Map();
  projectsSource: string | null = null; // describes where the active projects file came from
  projectCount = 0;
  cycleCount = 0;
  projectWarnings: string[] = [];
  /** True while a /api/sync request is in flight — guards against two
   *  concurrent syncs doubling upstream traffic and interleaving writes. */
  syncInFlight = false;

  constructor(config: ServerConfig = loadConfig(), db: MetricsDb = new MetricsDb(config.dbPath)) {
    this.config = config;
    this.db = db;
    this.loadDefaultCsv();
    this.loadDefaultProjects();
  }

  /** A malformed CSV_PATH/PROJECTS_PATH must not take the whole server down at
   *  boot — start with an empty map instead and surface the problem via
   *  /api/status.projectWarnings, which already exists for exactly this. */
  private loadDefaultCsv(): void {
    const { csvPath } = this.config;
    if (!csvPath || !existsSync(csvPath)) return;
    try {
      const { attributes, count } = loadAttributesCsv(csvPath);
      this.attributes = attributes;
      this.csvSource = `${csvPath} (${count} rows)`;
    } catch (err) {
      this.projectWarnings.push(
        `CSV_PATH (${csvPath}) failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private loadDefaultProjects(): void {
    const { projectsPath } = this.config;
    if (!projectsPath || !existsSync(projectsPath)) return;
    try {
      const result = loadProjectsYaml(projectsPath);
      this.setProjects(result, `${projectsPath} (${result.projectCount} project(s))`);
    } catch (err) {
      this.projectWarnings.push(
        `PROJECTS_PATH (${projectsPath}) failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  setAttributes(attributes: AttributeMap, source: string): void {
    this.attributes = attributes;
    this.csvSource = source;
  }

  setProjects(result: ProjectsParseResult, source: string): void {
    this.memberships = result.index;
    this.cycles = result.cycles;
    this.projectCount = result.projectCount;
    this.cycleCount = result.cycleCount;
    this.projectWarnings = result.warnings;
    this.projectsSource = source;
  }
}
