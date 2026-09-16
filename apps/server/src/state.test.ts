import { test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsDb } from "@claude-analytics/core";
import { AppState, loadConfig, parseAllowedOrigins, type ServerConfig } from "./state.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.PORT;
  delete process.env.ALLOWED_ORIGINS;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-analytics-state-test-"));
  dirs.push(dir);
  return dir;
}

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    apiKey: "k",
    dbPath: ":memory:",
    csvPath: undefined,
    projectsPath: undefined,
    port: 0,
    allowedOrigins: [],
    ...overrides,
  };
}

// ---- loadConfig: PORT validation (#18 item 6) ----

test("loadConfig: a missing PORT defaults to 3000", () => {
  expect(loadConfig().port).toBe(3000);
});

test("loadConfig: a valid PORT is accepted", () => {
  process.env.PORT = "8080";
  expect(loadConfig().port).toBe(8080);
});

test("loadConfig: a non-numeric PORT fails fast with a clear message, rather than binding NaN", () => {
  process.env.PORT = "three";
  expect(() => loadConfig()).toThrow(/Invalid PORT/);
});

test("loadConfig: a PORT outside 0-65535 fails fast", () => {
  process.env.PORT = "-1";
  expect(() => loadConfig()).toThrow(/Invalid PORT/);
  process.env.PORT = "70000";
  expect(() => loadConfig()).toThrow(/Invalid PORT/);
});

// ---- parseAllowedOrigins / ALLOWED_ORIGINS ----

test("parseAllowedOrigins: unset or empty is an empty list, not a crash", () => {
  expect(parseAllowedOrigins(undefined)).toEqual([]);
  expect(parseAllowedOrigins("")).toEqual([]);
  expect(parseAllowedOrigins("  ")).toEqual([]);
});

test("parseAllowedOrigins: comma-separated entries are split, trimmed and lowercased", () => {
  expect(parseAllowedOrigins("Staging.Example.com, preview.example.com")).toEqual([
    "staging.example.com",
    "preview.example.com",
  ]);
});

test("parseAllowedOrigins: a full origin is reduced to its host, port kept", () => {
  expect(parseAllowedOrigins("http://localhost:5173")).toEqual(["localhost:5173"]);
  expect(parseAllowedOrigins("https://staging.example.com/")).toEqual(["staging.example.com"]);
});

test("parseAllowedOrigins: empty segments (a trailing comma) are skipped, duplicates collapsed", () => {
  expect(parseAllowedOrigins("a.example.com,,b.example.com,")).toEqual(["a.example.com", "b.example.com"]);
  expect(parseAllowedOrigins("https://a.example.com,a.example.com")).toEqual(["a.example.com"]);
});

test("parseAllowedOrigins: a wildcard entry is preserved for subdomain matching", () => {
  expect(parseAllowedOrigins("*.preview.example.com,*.example.com:8080")).toEqual([
    "*.preview.example.com",
    "*.example.com:8080",
  ]);
});

test("parseAllowedOrigins: a malformed entry fails fast rather than silently widening the guard", () => {
  expect(() => parseAllowedOrigins("not a host")).toThrow(/Invalid ALLOWED_ORIGINS entry/);
  expect(() => parseAllowedOrigins("good.example.com,*")).toThrow(/Invalid ALLOWED_ORIGINS entry/);
  expect(() => parseAllowedOrigins("example.com:99999999")).toThrow(/Invalid ALLOWED_ORIGINS entry/);
});

test("loadConfig: ALLOWED_ORIGINS is read from the environment", () => {
  process.env.ALLOWED_ORIGINS = "http://localhost:5173,*.preview.example.com";
  expect(loadConfig().allowedOrigins).toEqual(["localhost:5173", "*.preview.example.com"]);
});

// `delete` explicitly rather than relying on absence: state.ts imports
// dotenv/config, so a developer's own .env would otherwise leak into this test.
test("loadConfig: a missing ALLOWED_ORIGINS leaves the guard same-origin-only", () => {
  delete process.env.ALLOWED_ORIGINS;
  expect(loadConfig().allowedOrigins).toEqual([]);
});

// ---- AppState: malformed config files don't crash the server at boot (#18 item 5) ----

test("AppState: a malformed CSV_PATH doesn't throw — it's reported via projectWarnings and attributes stay empty", () => {
  const dir = tempDir();
  const csvPath = join(dir, "bad.csv");
  writeFileSync(csvPath, "name,Level\na,Senior\n"); // no "email" column -> loadAttributesCsv rejects this

  const state = new AppState(baseConfig({ csvPath }), new MetricsDb(":memory:"));
  expect(state.attributes.size).toBe(0);
  expect(state.projectWarnings.some((w) => w.includes("CSV_PATH"))).toBe(true);
});

test("AppState: a valid CSV_PATH loads normally with no warnings", () => {
  const dir = tempDir();
  const csvPath = join(dir, "good.csv");
  writeFileSync(csvPath, "email,Level\na@x.com,Senior\n");

  const state = new AppState(baseConfig({ csvPath }), new MetricsDb(":memory:"));
  expect(state.attributes.size).toBe(1);
  expect(state.csvSource).toContain("good.csv");
});

test("AppState: a malformed PROJECTS_PATH doesn't throw — it's reported via projectWarnings", () => {
  const dir = tempDir();
  const projectsPath = join(dir, "bad.yaml");
  writeFileSync(projectsPath, "not: [valid, yaml"); // unterminated flow sequence

  const state = new AppState(baseConfig({ projectsPath }), new MetricsDb(":memory:"));
  expect(state.memberships.size).toBe(0);
  expect(state.projectWarnings.some((w) => w.includes("PROJECTS_PATH"))).toBe(true);
});

test("AppState: a valid PROJECTS_PATH loads normally", () => {
  const dir = tempDir();
  const projectsPath = join(dir, "good.yaml");
  writeFileSync(
    projectsPath,
    "projects:\n  - name: Acme\n    members:\n      - email: a@x.com\n        start: 2026-01-01\n",
  );

  const state = new AppState(baseConfig({ projectsPath }), new MetricsDb(":memory:"));
  expect(state.projectCount).toBe(1);
});

test("AppState: no csvPath/projectsPath at all is a no-op, not an error", () => {
  const state = new AppState(baseConfig(), new MetricsDb(":memory:"));
  expect(state.attributes.size).toBe(0);
  expect(state.projectWarnings).toEqual([]);
});

// ---- setAttributes / setProjects (upload path) ----

test("AppState.setAttributes: replaces attributes and records the source", () => {
  const state = new AppState(baseConfig(), new MetricsDb(":memory:"));
  state.setAttributes(new Map([["a@x.com", { Level: "Senior" }]]), "upload: test.csv");
  expect(state.attributes.size).toBe(1);
  expect(state.csvSource).toBe("upload: test.csv");
});
