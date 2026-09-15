import { test, expect } from "vitest";
import type { ProjectsParseResult } from "@claude-analytics/core";
import { runProjects } from "./projects.js";

function parseResult(overrides: Partial<ProjectsParseResult> = {}): ProjectsParseResult {
  return {
    index: new Map(),
    cycles: new Map(),
    projectCount: 0,
    memberCount: 0,
    cycleCount: 0,
    warnings: [],
    ...overrides,
  };
}

test("runProjects: no path configured reports how to fix it", () => {
  const result = runProjects({}, { path: undefined });
  expect(result.code).toBe(0);
  expect(result.lines).toEqual(["No projects file configured. Pass --projects <path> or set PROJECTS_PATH in .env."]);
});

test("runProjects: a load failure is reported with an exit code, not thrown", () => {
  const result = runProjects(
    {
      loadYaml: () => {
        throw new Error("bad yaml");
      },
    },
    { path: "bad.yaml" },
  );
  expect(result.code).toBe(1);
  expect(result.lines).toEqual(["Failed to load bad.yaml: bad yaml"]);
});

test("runProjects: an empty file reports no projects found", () => {
  const result = runProjects({ loadYaml: () => parseResult() }, { path: "empty.yaml" });
  expect(result.code).toBe(0);
  expect(result.lines).toEqual(["No projects found in empty.yaml."]);
});

test("runProjects: summarizes projects, members, and cycles", () => {
  const index = new Map([
    ["a@x.com", [{ project: "P1", team: "T1", client: "C1", start: "2026-01-01", end: null, allocation: 1 }]],
  ]);
  const cycles = new Map([
    ["P1", [{ project: "P1", name: "Discovery", start: "2026-01-01", end: "2026-02-01", derivedEnd: false }]],
  ]);
  const result = runProjects(
    { loadYaml: () => parseResult({ index, cycles, projectCount: 1, memberCount: 1, cycleCount: 1 }) },
    { path: "projects.yaml" },
  );
  expect(result.code).toBe(0);
  const text = result.lines.join("\n");
  expect(text).toContain("1 project(s), 1 membership(s), 1 cycle(s)");
  expect(text).toContain("P1");
  expect(text).toContain("Discovery");
});

test("runProjects: --project filters the cycle listing to one project", () => {
  const index = new Map([
    ["a@x.com", [{ project: "P1", team: "T1", client: "C1", start: "2026-01-01", end: null, allocation: 1 }]],
    ["b@x.com", [{ project: "P2", team: "T2", client: "C2", start: "2026-01-01", end: null, allocation: 1 }]],
  ]);
  const cycles = new Map([
    ["P1", [{ project: "P1", name: "Discovery", start: "2026-01-01", end: null, derivedEnd: false }]],
    ["P2", [{ project: "P2", name: "Build", start: "2026-01-01", end: null, derivedEnd: false }]],
  ]);
  const result = runProjects(
    { loadYaml: () => parseResult({ index, cycles, projectCount: 2, memberCount: 2, cycleCount: 2 }) },
    { path: "projects.yaml", project: "P1" },
  );
  const text = result.lines.join("\n");
  expect(text).toContain("Discovery");
  expect(text).not.toContain("Build");
});

test("runProjects: surfaces parse warnings", () => {
  const result = runProjects(
    { loadYaml: () => parseResult({ projectCount: 1, memberCount: 1, warnings: ["overlapping membership"] }) },
    { path: "projects.yaml" },
  );
  expect(result.lines.some((l) => l.includes("overlapping membership"))).toBe(true);
});
