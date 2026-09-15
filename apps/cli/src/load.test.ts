import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadCsvOptional, loadProjectsOptional } from "./load.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-load-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("loadCsvOptional: no path configured returns an empty map, no warning", () => {
  const result = loadCsvOptional(undefined);
  expect(result).toEqual({ attributes: new Map(), warning: null });
});

test("loadCsvOptional: a valid CSV loads with no warning", () => {
  const path = join(dir, "attrs.csv");
  writeFileSync(path, "email,Role\na@x.com,Engineer\n");
  const result = loadCsvOptional(path);
  expect(result.warning).toBeNull();
  expect(result.attributes.get("a@x.com")).toEqual({ Role: "Engineer" });
});

// #30: a missing/malformed CSV used to silently return an empty map with no
// indication anything failed — group --group-by <col> then either errored
// with a misleading "invalid --group-by" or reported everything as
// unmatched. It must now surface a warning the caller can print.
test("loadCsvOptional: a path that doesn't exist surfaces a warning instead of failing silently", () => {
  const result = loadCsvOptional(join(dir, "does-not-exist.csv"));
  expect(result.attributes.size).toBe(0);
  expect(result.warning).toMatch(/^Failed to load CSV /);
});

test("loadProjectsOptional: no path configured returns an empty index, no warning", () => {
  const result = loadProjectsOptional(undefined);
  expect(result).toEqual({ memberships: new Map(), warning: null });
});

test("loadProjectsOptional: malformed YAML surfaces a warning instead of failing silently", () => {
  const path = join(dir, "projects.yaml");
  writeFileSync(path, "not: [valid, yaml", "utf8");
  const result = loadProjectsOptional(path);
  expect(result.memberships.size).toBe(0);
  expect(result.warning).toMatch(/^Failed to load projects file /);
});
