import { test, expect } from "vitest";
import {
  cycleFor,
  cyclesFor,
  membershipKeys,
  NONE_KEY,
  parseProjectsYaml,
  UNASSIGNED_KEY,
} from "./projects.js";

const YAML_BASIC_CYCLES = `
projects:
  - name: "Flow Team #1"
    team: Flow
    cycles:
      - name: Discovery
        start: 2026-03-25
      - name: Build
        start: 2026-04-14
        end: 2026-05-31
      - name: Harden
        start: 2026-06-01
    members:
      - email: a@x.com
        start: 2026-03-25
`;

test("interior null end resolves to the day before the next cycle's start", () => {
  const { cycles, warnings } = parseProjectsYaml(YAML_BASIC_CYCLES);
  const list = cyclesFor(cycles, "Flow Team #1");
  expect(list.length).toBe(3);
  const discovery = list.find((c) => c.name === "Discovery")!;
  expect(discovery.end).toBe("2026-04-13"); // day before Build's 2026-04-14 start
  expect(discovery.derivedEnd).toBe(true);
  expect(warnings.filter((w) => w.includes("Discovery"))).toEqual([]);
});

test("the final open cycle stays null (open-ended), not resolved against a clock", () => {
  const { cycles } = parseProjectsYaml(YAML_BASIC_CYCLES);
  const harden = cyclesFor(cycles, "Flow Team #1").find((c) => c.name === "Harden")!;
  expect(harden.end).toBe(null);
  expect(harden.derivedEnd).toBe(false);
});

test("an explicit end that overlaps the next cycle is clamped and warned", () => {
  const yaml = `
projects:
  - name: P
    cycles:
      - name: A
        start: 2026-01-01
        end: 2026-02-15   # overlaps B's start
      - name: B
        start: 2026-02-01
    members:
      - email: a@x.com
        start: 2026-01-01
`;
  const { cycles, warnings } = parseProjectsYaml(yaml);
  const a = cyclesFor(cycles, "P").find((c) => c.name === "A")!;
  expect(a.end).toBe("2026-01-31"); // day before B's 2026-02-01 start
  expect(warnings.some((w) => w.includes("overlaps the next cycle") && w.includes("truncated to 2026-01-31"))).toBe(true);
});

test("duplicate cycle names within a project are disambiguated", () => {
  const yaml = `
projects:
  - name: P
    cycles:
      - name: Sprint
        start: 2026-01-01
      - name: Sprint
        start: 2026-02-01
    members:
      - email: a@x.com
        start: 2026-01-01
`;
  const { cycles, warnings } = parseProjectsYaml(yaml);
  const names = cyclesFor(cycles, "P").map((c) => c.name);
  expect(names).toEqual(["Sprint", "Sprint (2)"]);
  expect(warnings.some((w) => w.includes("duplicate cycle name"))).toBe(true);
});

test("cycleFor: the next-start day belongs to the new cycle, not the old one", () => {
  const { cycles } = parseProjectsYaml(YAML_BASIC_CYCLES);
  expect(cycleFor(cycles, "Flow Team #1", "2026-04-13")?.name).toBe("Discovery");
  expect(cycleFor(cycles, "Flow Team #1", "2026-04-14")?.name).toBe("Build");
});

test("a cycle window outside every member assignment warns", () => {
  const yaml = `
projects:
  - name: P
    cycles:
      - name: TooEarly
        start: 2025-01-01
        end: 2025-06-01
    members:
      - email: a@x.com
        start: 2026-01-01
`;
  const { warnings } = parseProjectsYaml(yaml);
  expect(warnings.some((w) => w.includes("falls outside every member assignment"))).toBe(true);
});

test("a project with cycles but no valid members warns", () => {
  const yaml = `
projects:
  - name: P
    cycles:
      - name: A
        start: 2026-01-01
    members: []
`;
  const { warnings } = parseProjectsYaml(yaml);
  expect(warnings.some((w) => w.includes("has cycles but no valid members"))).toBe(true);
});

test("membershipKeys still works unaffected by cycles (Unassigned / (none) untouched)", () => {
  const { index } = parseProjectsYaml(YAML_BASIC_CYCLES);
  const keys = membershipKeys(index, "a@x.com", "2026-04-01", "team");
  expect(keys).toEqual([{ key: "Flow", weight: 1 }]);
  const noMember = membershipKeys(index, "nobody@x.com", "2026-04-01", "project");
  expect(noMember).toEqual([{ key: UNASSIGNED_KEY, weight: 1 }]);
});

test("a project with no team/client falls back to NONE_KEY", () => {
  const yaml = `
projects:
  - name: P
    members:
      - email: a@x.com
        start: 2026-01-01
`;
  const { index } = parseProjectsYaml(yaml);
  const keys = membershipKeys(index, "a@x.com", "2026-01-02", "team");
  expect(keys).toEqual([{ key: NONE_KEY, weight: 1 }]);
});
