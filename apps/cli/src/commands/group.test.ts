import { test, expect } from "vitest";
import { testDb, userDayRow, userProductRow } from "../__tests__/helpers.js";
import { runGroup } from "./group.js";

test("runGroup: an invalid --group-by errors instead of aggregating", () => {
  const db = testDb();
  try {
    const result = runGroup({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, { groupBy: "Nope" });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toMatch(/^Invalid --group-by/);
  } finally {
    db.close();
  }
});

test("runGroup: groups usage by a CSV column", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([
      userProductRow({ userId: "u1", email: "a@x.com", costCents: 300 }),
      userProductRow({ userId: "u2", email: "b@x.com", costCents: 200 }),
    ]);
    db.upsertUserDays([userDayRow({ userId: "u1", email: "a@x.com" }), userDayRow({ userId: "u2", email: "b@x.com" })]);
    const attributes = new Map([
      ["a@x.com", { Team: "Platform" }],
      ["b@x.com", { Team: "Platform" }],
    ]);
    const result = runGroup({ db, attributes, memberships: new Map(), warnings: [] }, { groupBy: "Team" });
    expect(result.code).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("Usage by Team:");
    expect(text).toContain("Platform");
    expect(text).toContain("$5.00"); // 300 + 200 cents combined
  } finally {
    db.close();
  }
});

test("runGroup: @member groups by raw email with no CSV loaded", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 100 })]);
    db.upsertUserDays([userDayRow({ email: "a@x.com" })]);
    const result = runGroup(
      { db, attributes: new Map(), memberships: new Map(), warnings: [] },
      { groupBy: "@member" },
    );
    expect(result.lines.join("\n")).toContain("a@x.com");
  } finally {
    db.close();
  }
});

test("runGroup: prepends any load-failure warnings passed in deps", () => {
  const db = testDb();
  try {
    const result = runGroup(
      { db, attributes: new Map(), memberships: new Map(), warnings: ["Failed to load CSV /bad.csv: ENOENT"] },
      { groupBy: "@member" },
    );
    expect(result.lines[0]).toBe("Failed to load CSV /bad.csv: ENOENT");
  } finally {
    db.close();
  }
});
