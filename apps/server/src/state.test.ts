import { test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsDb } from "@claude-analytics/core";
import { AppState, loadConfig, type ServerConfig } from "./state.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.PORT;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-analytics-state-test-"));
  dirs.push(dir);
  return dir;
}

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { apiKey: "k", dbPath: ":memory:", csvPath: undefined, projectsPath: undefined, port: 0, ...overrides };
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
