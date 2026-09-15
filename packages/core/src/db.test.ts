import { test, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsDb } from "./db.js";
import { orgProductRow, userDayRow } from "./__fixtures__/index.js";

/** A fresh in-memory MetricsDb for one test — real SQLite, no file on disk. */
function freshDb(): MetricsDb {
  return new MetricsDb(":memory:");
}

test("getUserDays: raw is omitted by default (see #28 — avoids a JSON.parse + discarded object per row)", () => {
  const db = freshDb();
  db.upsertUserDays([userDayRow({ chatMessages: 3 })]);
  const [row] = db.getUserDays();
  expect(row!.raw).toBeUndefined();
  db.close();
});

test("getUserDays: includeRaw: true reconstitutes the original per-day record", () => {
  const db = freshDb();
  const seeded = userDayRow({ chatMessages: 3 });
  db.upsertUserDays([seeded]);
  const [row] = db.getUserDays({ includeRaw: true });
  expect(row!.raw).toEqual(seeded.raw);
  db.close();
});

test("upsertUserDays: a row with no `raw` at all (now optional) doesn't violate raw_json's NOT NULL column", () => {
  const db = freshDb();
  const { raw: _raw, ...withoutRaw } = userDayRow({ chatMessages: 3 });
  expect(() => db.upsertUserDays([withoutRaw])).not.toThrow();
  const [row] = db.getUserDays({ includeRaw: true });
  expect(row!.raw).toBe(null);
  db.close();
});

test("upsertOrgProducts / getOrgProducts: round-trips cacheReadTokens", () => {
  const db = freshDb();
  db.upsertOrgProducts([orgProductRow({ cacheReadTokens: 42, totalTokens: 100 })]);
  const [row] = db.getOrgProducts();
  expect(row!.cacheReadTokens).toBe(42);
  db.close();
});

test("migrate: a pre-existing org_product table without cache_read_tokens gets it added, defaulting to 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-analytics-db-test-"));
  const path = join(dir, "analytics.db");

  // Hand-craft the pre-migration schema (no cache_read_tokens column) with a
  // real row in it, then let MetricsDb open and migrate it in place.
  const seedDb = new Database(path);
  seedDb.exec(`
    CREATE TABLE org_product (
      date TEXT NOT NULL, product TEXT NOT NULL,
      cost_cents REAL NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, product)
    )
  `);
  seedDb
    .prepare(
      `INSERT INTO org_product (date, product, cost_cents, total_tokens, input_tokens, output_tokens, requests)
       VALUES ('2026-06-01', 'chat', 100, 40, 10, 20, 1)`,
    )
    .run();
  seedDb.close();

  const db = new MetricsDb(path);
  const [row] = db.getOrgProducts();
  expect(row!.cacheReadTokens).toBe(0);
  expect(row!.costCents).toBe(100);
  db.close();

  rmSync(dir, { recursive: true, force: true });
});
