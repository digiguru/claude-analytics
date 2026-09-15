import { test, expect } from "vitest";
import { orgProductRow, summaryRow, testDb, userProductRow } from "../__tests__/helpers.js";
import { runOverview } from "./overview.js";

test("runOverview: no cached data reports that instead of crashing", () => {
  const db = testDb();
  try {
    const result = runOverview({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, {});
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(['No cached data. Run "sync" for the date range first.']);
  } finally {
    db.close();
  }
});

test("runOverview: reports total cost/tokens, product totals, heaviest days and top users", () => {
  const db = testDb();
  try {
    db.upsertSummaries([summaryRow({ date: "2026-06-01" })]);
    db.upsertOrgProducts([orgProductRow({ date: "2026-06-01", product: "chat", costCents: 500, totalTokens: 100 })]);
    db.upsertUserProducts([userProductRow({ date: "2026-06-01", email: "a@x.com", costCents: 500, totalTokens: 100 })]);

    const result = runOverview({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, {});
    expect(result.code).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("Total cost: $5.00");
    expect(text).toContain("Cost by product:");
    expect(text).toContain("Heaviest days (by cost):");
    expect(text).toContain("Top 5 users (by cost):");
    expect(text).toContain("a@x.com");
  } finally {
    db.close();
  }
});

test("runOverview: prepends any load-failure warnings passed in deps", () => {
  const db = testDb();
  try {
    const result = runOverview(
      { db, attributes: new Map(), memberships: new Map(), warnings: ["Failed to load CSV /bad.csv: ENOENT"] },
      {},
    );
    expect(result.lines[0]).toBe("Failed to load CSV /bad.csv: ENOENT");
  } finally {
    db.close();
  }
});
