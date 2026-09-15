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
  return {
    apiKey: process.env.ANTHROPIC_ANALYTICS_API_KEY ?? process.env.ANTHROPIC_ADMIN_API_KEY ?? "",
    dbPath: resolve(process.env.DB_PATH ?? "./data/analytics.db"),
    csvPath: process.env.CSV_PATH ? resolve(process.env.CSV_PATH) : undefined,
    projectsPath: resolve(process.env.PROJECTS_PATH ?? "./config/projects.yaml"),
    port: Number(process.env.PORT ?? 3000),
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

  constructor() {
    this.config = loadConfig();
    this.db = new MetricsDb(this.config.dbPath);
    this.loadDefaultCsv();
    this.loadDefaultProjects();
  }

  private loadDefaultCsv(): void {
    const { csvPath } = this.config;
    if (csvPath && existsSync(csvPath)) {
      const { attributes, count } = loadAttributesCsv(csvPath);
      this.attributes = attributes;
      this.csvSource = `${csvPath} (${count} rows)`;
    }
  }

  private loadDefaultProjects(): void {
    const { projectsPath } = this.config;
    if (projectsPath && existsSync(projectsPath)) {
      const result = loadProjectsYaml(projectsPath);
      this.setProjects(result, `${projectsPath} (${result.projectCount} project(s))`);
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
