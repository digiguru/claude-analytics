import { test, expect } from "vitest";
import { testDb } from "../__tests__/helpers.js";
import { runColumns } from "./columns.js";

test("runColumns: nothing loaded reports the fix, alongside @member", () => {
  const db = testDb();
  try {
    const result = runColumns({ db, attributes: new Map(), memberships: new Map(), warnings: [] });
    const text = result.lines.join("\n");
    expect(text).toContain("@member");
    expect(text).toContain("No CSV attributes or projects file loaded");
  } finally {
    db.close();
  }
});

test("runColumns: lists CSV columns when attributes are loaded", () => {
  const db = testDb();
  try {
    const attributes = new Map([["a@x.com", { Role: "Engineer", Team: "Platform" }]]);
    const result = runColumns({ db, attributes, memberships: new Map(), warnings: [] });
    const text = result.lines.join("\n");
    expect(text).toContain("Role");
    expect(text).toContain("Team");
    expect(text).not.toContain("Timeline (from your projects file)");
  } finally {
    db.close();
  }
});

test("runColumns: lists timeline facets when a projects file is loaded", () => {
  const db = testDb();
  try {
    const memberships = new Map([
      ["a@x.com", [{ project: "P1", team: "T1", client: "C1", start: "2026-01-01", end: null, allocation: 1 }]],
    ]);
    const result = runColumns({ db, attributes: new Map(), memberships, warnings: [] });
    const text = result.lines.join("\n");
    expect(text).toContain("Timeline (from your projects file):");
    expect(text).toContain("@project");
    expect(text).toContain("@team");
    expect(text).toContain("@client");
  } finally {
    db.close();
  }
});
