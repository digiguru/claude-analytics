import { test, expect } from "vitest";
import { buildApp } from "./app.js";
import { makeTestState, orgProductRow, summaryRow, userDayRow, userProductRow } from "./__tests__/helpers.js";

/**
 * API smoke test: buildApp + a real listening socket + real `fetch` calls
 * (not `inject`), proving the full HTTP serialization path — including
 * @fastify/static registration — works end to end, not just Fastify's
 * in-process injection shim. This is the safety net for the buildApp
 * refactor itself and the foundation the Playwright smoke test (Phase 6)
 * builds on. Per #35.
 */
test("API smoke: every route responds correctly over a real socket, seeded with a few days of data", async () => {
  const state = makeTestState();
  state.db.upsertSummaries([summaryRow()]);
  state.db.upsertOrgProducts([orgProductRow()]);
  state.db.upsertUserProducts([userProductRow()]);
  state.db.upsertUserDays([userDayRow()]);

  // serveStatic: true exercises the @fastify/static registration path too —
  // web/dist won't exist in CI, so it falls back to the "not found" log path,
  // which is itself part of what this test is meant to prove doesn't crash.
  const app = buildApp(state, { serveStatic: true, logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  try {
    const status = await fetch(`${base}/api/status`);
    expect(status.status).toBe(200);
    expect((await status.json()) as { apiKeyConfigured: boolean }).toMatchObject({ apiKeyConfigured: true });

    const overview = await fetch(`${base}/api/overview`);
    expect(overview.status).toBe(200);
    const overviewBody = (await overview.json()) as { totalCostCents: number };
    expect(overviewBody.totalCostCents).toBeGreaterThan(0);

    const groups = await fetch(`${base}/api/groups?groupBy=@member`);
    expect(groups.status).toBe(200);
    const groupsBody = (await groups.json()) as { groups: unknown[] };
    expect(groupsBody.groups.length).toBeGreaterThan(0);

    const users = await fetch(`${base}/api/users`);
    expect(users.status).toBe(200);
    const usersBody = (await users.json()) as { users: unknown[] };
    expect(usersBody.users.length).toBeGreaterThan(0);

    const member = await fetch(`${base}/api/members/${encodeURIComponent(userProductRow().email)}`);
    expect(member.status).toBe(200);

    const exportCsv = await fetch(`${base}/api/export?groupBy=@member`);
    expect(exportCsv.status).toBe(200);
    expect(exportCsv.headers.get("content-type")).toContain("text/csv");
    expect(await exportCsv.text()).toContain("seats");

    const exportDaily = await fetch(`${base}/api/export/groups-daily?groupBy=@member`);
    expect(exportDaily.status).toBe(200);

    const exportMembers = await fetch(`${base}/api/export/members`);
    expect(exportMembers.status).toBe(200);

    const exportMembersLong = await fetch(`${base}/api/export/members-long`);
    expect(exportMembersLong.status).toBe(200);

    // A route that doesn't exist and isn't /api -> falls through toward the
    // SPA fallback path (no web/dist present in CI, so this proves that
    // absence is handled rather than crashing the process).
    const notFound = await fetch(`${base}/not-a-route`);
    expect([404, 200]).toContain(notFound.status);
  } finally {
    await app.close();
  }
});
