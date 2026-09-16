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
  /** Extra browser origins allowed to make state-mutating requests, beyond the
   *  always-allowed same-origin case. See parseAllowedOrigins / originAllowed. */
  allowedOrigins: string[];
}

/** A bare host with optional port: `staging.example.com`, `localhost:5173`. */
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;
/** A subdomain wildcard: `*.preview.example.com`, `*.example.com:8080`. */
const WILDCARD_PATTERN = /^\*(\.[a-z0-9-]+)+(:\d{1,5})?$/;

/** Reduce one ALLOWED_ORIGINS entry to the host form originAllowed compares
 *  against: lowercased, scheme dropped, path/trailing slash dropped. */
function normalizeOriginEntry(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * Parse ALLOWED_ORIGINS — a comma-separated list of origins allowed to make
 * state-mutating requests (`/api/sync`, `/api/csv`, `/api/projects`) even
 * though they don't match the server's own `Host`. This exists for deployments
 * where the browser's origin legitimately differs from the host the server
 * sees: a `vite dev` proxy (which rewrites `Host` to its target), or a
 * staging/preview environment behind a proxy or CDN.
 *
 *   ALLOWED_ORIGINS=http://localhost:5173,staging.example.com,*.preview.example.com
 *
 * Each entry may be a full origin (the scheme is dropped — matching is on host,
 * same as the same-origin comparison it extends), a bare host with an optional
 * port, or a `*.`-prefixed wildcard matching any subdomain of that suffix but
 * never the bare parent. Note that browsers omit the default port from `Origin`,
 * so write `example.com`, not `example.com:443`.
 *
 * Empty segments are skipped (a trailing comma is harmless); an entry that is
 * neither a host nor a wildcard throws at boot, on the same reasoning as PORT —
 * a typo in a security setting must be loud, not silently ignored.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const origins: string[] = [];
  for (const segment of raw.split(",")) {
    const entry = normalizeOriginEntry(segment);
    if (!entry) continue;
    if (!HOST_PATTERN.test(entry) && !WILDCARD_PATTERN.test(entry)) {
      throw new Error(
        `Invalid ALLOWED_ORIGINS entry "${segment.trim()}" — expected a host, an origin, ` +
          `or a "*."-prefixed wildcard (e.g. http://localhost:5173, staging.example.com, *.preview.example.com).`,
      );
    }
    if (!origins.includes(entry)) origins.push(entry);
  }
  return origins;
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
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
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
