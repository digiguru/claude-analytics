import { test, expect } from "vitest";
import type { EnterpriseClient } from "@claude-analytics/core";
import { testDb } from "../__tests__/helpers.js";
import { runSync } from "./sync.js";

/** A no-op EnterpriseClient — every method returns empty results, so
 *  fetchRange runs for real (against the real in-memory DB) without any
 *  network I/O. Individual product/method behaviour is already covered by
 *  packages/core/src/sync.test.ts; this only needs to exercise runSync's own
 *  line-formatting of fetchRange's result. */
function emptyClient(): EnterpriseClient {
  return {
    getSummaries: async () => [],
    getUserActivity: async () => [],
    getUserCost: async () => [],
    getUserUsage: async () => [],
    getOrgCost: async () => [],
    getOrgUsage: async () => [],
  };
}

test("runSync: a historical range reports the synced counts", async () => {
  const db = testDb();
  try {
    const result = await runSync({ client: emptyClient(), db }, { from: "2026-01-01", to: "2026-01-02" });
    expect(result.code).toBe(0);
    expect(result.lines.some((l) => l.includes("Synced 2026-01-01..2026-01-02"))).toBe(true);
  } finally {
    db.close();
  }
});

test("runSync: a range with nothing to fetch reports that instead of a synced count", async () => {
  const db = testDb();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await runSync({ client: emptyClient(), db }, { from: today, to: today });
    expect(result.code).toBe(0);
    expect(result.lines.some((l) => l.startsWith("Nothing to sync"))).toBe(true);
  } finally {
    db.close();
  }
});
