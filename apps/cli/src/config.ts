import "dotenv/config";
import { resolve } from "node:path";

export interface CliConfig {
  apiKey: string;
  dbPath: string;
  csvPath?: string;
  projectsPath?: string;
}

export function loadConfig(): CliConfig {
  return {
    // Prefer the Enterprise Analytics key name; fall back to the old name.
    apiKey: process.env.ANTHROPIC_ANALYTICS_API_KEY ?? process.env.ANTHROPIC_ADMIN_API_KEY ?? "",
    dbPath: resolve(process.env.DB_PATH ?? "./data/analytics.db"),
    csvPath: process.env.CSV_PATH ? resolve(process.env.CSV_PATH) : undefined,
    projectsPath: resolve(process.env.PROJECTS_PATH ?? "./config/projects.yaml"),
  };
}
