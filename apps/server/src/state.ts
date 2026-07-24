import "dotenv/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  loadAttributesCsv,
  MetricsDb,
  type AttributeMap,
} from "@claude-analytics/core";

export interface ServerConfig {
  apiKey: string;
  dbPath: string;
  csvPath?: string;
  port: number;
}

export function loadConfig(): ServerConfig {
  return {
    apiKey: process.env.ANTHROPIC_ANALYTICS_API_KEY ?? process.env.ANTHROPIC_ADMIN_API_KEY ?? "",
    dbPath: resolve(process.env.DB_PATH ?? "./data/analytics.db"),
    csvPath: process.env.CSV_PATH ? resolve(process.env.CSV_PATH) : undefined,
    port: Number(process.env.PORT ?? 3000),
  };
}

/** Mutable server state: the DB handle plus the active attributes CSV. */
export class AppState {
  readonly config: ServerConfig;
  readonly db: MetricsDb;
  attributes: AttributeMap = new Map();
  csvSource: string | null = null; // describes where the active CSV came from

  constructor() {
    this.config = loadConfig();
    this.db = new MetricsDb(this.config.dbPath);
    this.loadDefaultCsv();
  }

  private loadDefaultCsv(): void {
    const { csvPath } = this.config;
    if (csvPath && existsSync(csvPath)) {
      const { attributes, count } = loadAttributesCsv(csvPath);
      this.attributes = attributes;
      this.csvSource = `${csvPath} (${count} rows)`;
    }
  }

  setAttributes(attributes: AttributeMap, source: string): void {
    this.attributes = attributes;
    this.csvSource = source;
  }
}
