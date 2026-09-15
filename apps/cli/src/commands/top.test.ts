import { test, expect } from "vitest";
import { testDb, userProductRow } from "../__tests__/helpers.js";
import { runTop } from "./top.js";

test("runTop: no cached data reports that instead of an empty table", () => {
  const db = testDb();
  try {
    const result = runTop({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, {});
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(['No cached data. Run "sync" first.']);
  } finally {
    db.close();
  }
});

test("runTop: ranks users by cost by default", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([
      userProductRow({ userId: "u1", email: "cheap@x.com", costCents: 100, totalTokens: 1000 }),
      userProductRow({ userId: "u2", email: "pricey@x.com", costCents: 900, totalTokens: 10 }),
    ]);
    const result = runTop({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, {});
    const text = result.lines.join("\n");
    expect(text.indexOf("pricey@x.com")).toBeLessThan(text.indexOf("cheap@x.com"));
  } finally {
    db.close();
  }
});

test("runTop: --by tokens ranks by tokens instead of cost", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([
      userProductRow({ userId: "u1", email: "cheap@x.com", costCents: 100, totalTokens: 1000 }),
      userProductRow({ userId: "u2", email: "pricey@x.com", costCents: 900, totalTokens: 10 }),
    ]);
    const result = runTop({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, { by: "tokens" });
    const text = result.lines.join("\n");
    expect(text.indexOf("cheap@x.com")).toBeLessThan(text.indexOf("pricey@x.com"));
  } finally {
    db.close();
  }
});

// #30: an unrecognised --by (e.g. a "tokens" typo) used to silently rank by
// cost with no indication anything was wrong. It must now error instead.
test("runTop: an unrecognised --by errors rather than silently falling back to cost", () => {
  const db = testDb();
  try {
    const result = runTop({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, { by: "tokns" });
    expect(result.code).toBe(1);
    expect(result.lines).toEqual(['Invalid --by "tokns". Expected "cost" or "tokens".']);
  } finally {
    db.close();
  }
});

test("runTop: --limit caps the ranked list", () => {
  const db = testDb();
  try {
    db.upsertUserProducts([
      userProductRow({ userId: "u1", email: "a@x.com", costCents: 300 }),
      userProductRow({ userId: "u2", email: "b@x.com", costCents: 200 }),
      userProductRow({ userId: "u3", email: "c@x.com", costCents: 100 }),
    ]);
    const result = runTop({ db, attributes: new Map(), memberships: new Map(), warnings: [] }, { limit: "2" });
    expect(result.lines.some((l) => l.startsWith("Top 2 users"))).toBe(true);
  } finally {
    db.close();
  }
});
