import { test, expect } from "vitest";
import { testDb, userDayRow, userProductRow } from "../__tests__/helpers.js";
import { runMember } from "./member.js";

test("runMember: no cached data for the email reports that instead of an empty report", () => {
  const db = testDb();
  try {
    const result = runMember({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, { email: "a@x.com" });
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(['No cached metrics for a@x.com. Run "sync" first.']);
  } finally {
    db.close();
  }
});

test("runMember: reports totals, per-product cost, and CSV attributes when present", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 300, totalTokens: 50 })]);
    db.upsertUserDays([userDayRow({ email: "a@x.com" })]);
    const attributes = new Map([["a@x.com", { Role: "Engineer" }]]);
    const result = runMember({ db, attributes, memberships: new Map(), warnings: [] }, { email: "a@x.com" });
    expect(result.code).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("a@x.com — Engineer");
    expect(text).toContain("cost: $3.00");
    expect(text).toContain("Cost by product:");
    expect(text).toContain("chat");
  } finally {
    db.close();
  }
});
