import { test, expect } from "vitest";
import { buildApp } from "./app.js";
import {
  makeTestState,
  orgProductRow,
  summaryRow,
  userDayRow,
  userProductRow,
  withCsv,
  withProjects,
} from "./__tests__/helpers.js";

function createTestApp(state = makeTestState()) {
  return { app: buildApp(state, { serveStatic: false, logger: false }), state };
}

function multipartBody(filename: string, content: string, contentType = "text/csv") {
  const boundary = "----vitestboundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

// ---- /api/status ----

test("/api/status: happy path reports CSV/projects/cache state", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/status" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.csvLoaded).toBe(false);
  expect(body.projectsLoaded).toBe(false);
  expect(body.apiKeyConfigured).toBe(true);
});

// ---- /api/overview ----

test("/api/overview: unfiltered vs filtered-to-everyone reconcile (HTTP-level companion to the Phase 2 core test)", async () => {
  const { app, state } = createTestApp();
  state.db.upsertSummaries([summaryRow()]);
  state.db.upsertOrgProducts([orgProductRow({ costCents: 100, totalTokens: 40 })]);
  state.db.upsertUserProducts([userProductRow({ costCents: 100, totalTokens: 40 })]);

  const unfiltered = await app.inject({ method: "GET", url: "/api/overview" });
  const filtered = await app.inject({
    method: "GET",
    url: "/api/overview?filter=" + encodeURIComponent(JSON.stringify({ hidden: { Level: ["nobody-matches-this"] } })),
  });
  expect(unfiltered.statusCode).toBe(200);
  expect(filtered.statusCode).toBe(200);
  expect(filtered.json().totalCostCents).toBe(unfiltered.json().totalCostCents);
  expect(filtered.json().totalTokens).toBe(unfiltered.json().totalTokens);
  expect(unfiltered.json().filtered).toBe(false);
  expect(filtered.json().filtered).toBe(true);
});

test("/api/overview: malformed 'from' is a 400, not an empty result indistinguishable from no data", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/overview?from=2026-13-99" });
  expect(res.statusCode).toBe(400);
});

test("/api/overview: from > to is a 400", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/overview?from=2026-06-10&to=2026-06-01" });
  expect(res.statusCode).toBe(400);
});

// ---- /api/groups ----

test("/api/groups: @project groupBy", async () => {
  const { app, state } = createTestApp();
  withProjects(
    state,
    `
projects:
  - name: Acme
    members:
      - email: a@x.com
        start: 2026-01-01
`,
  );
  state.db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 100 })]);
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=@project" });
  expect(res.statusCode).toBe(200);
  expect(res.json().dimension).toBe("@project");
  expect(res.json().groups.map((g: { key: string }) => g.key)).toContain("Acme");
});

test("/api/groups: @member groupBy works with no CSV or projects file loaded", async () => {
  const { app, state } = createTestApp();
  state.db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 100 })]);
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=@member" });
  expect(res.statusCode).toBe(200);
  expect(res.json().groups.map((g: { key: string }) => g.key)).toEqual(["a@x.com"]);
});

test("/api/groups: a CSV column groupBy", async () => {
  const { app, state } = createTestApp();
  withCsv(state, "email,Level\na@x.com,Senior\n");
  state.db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 100 })]);
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=Level" });
  expect(res.statusCode).toBe(200);
  expect(res.json().groups.map((g: { key: string }) => g.key)).toEqual(["Senior"]);
});

test("/api/groups: @cycle with zero active projects in range is a clean 400, not a 500", async () => {
  const { app, state } = createTestApp();
  withProjects(
    state,
    `
projects:
  - name: Acme
    members:
      - email: a@x.com
        start: 2026-01-01
`,
  );
  // No cost data at all -> activeProjects is empty.
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=@cycle" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/no.*cost in range/i);
});

test("/api/groups: @cycle with more than one active project is a clean 400, not a 500", async () => {
  const { app, state } = createTestApp();
  withProjects(
    state,
    `
projects:
  - name: Acme
    members:
      - email: a@x.com
        start: 2026-01-01
  - name: Globex
    members:
      - email: b@x.com
        start: 2026-01-01
`,
  );
  state.db.upsertUserProducts([
    userProductRow({ userId: "u1", email: "a@x.com", costCents: 100 }),
    userProductRow({ userId: "u2", email: "b@x.com", costCents: 100 }),
  ]);
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=@cycle" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/single project/i);
});

test("/api/groups: an invalid groupBy is a 400 listing available dimensions", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/groups?groupBy=bogus" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/@member/);
});

// ---- /api/members/:email ----

test("/api/members/:email: happy path", async () => {
  const { app, state } = createTestApp();
  state.db.upsertUserProducts([userProductRow({ email: "a@x.com", costCents: 100 })]);
  state.db.upsertUserDays([userDayRow({ email: "a@x.com" })]);
  const res = await app.inject({ method: "GET", url: "/api/members/a@x.com" });
  expect(res.statusCode).toBe(200);
  expect(res.json().totalCostCents).toBe(100);
});

test("/api/members/:email: a malformed percent-escape is a 400, not a 500", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/members/%E0%A4%A" });
  expect(res.statusCode).toBe(400);
});

// ---- /api/sync ----

test("/api/sync: malformed dates are a 400, not a 502 (the client didn't fail upstream — it never got there)", async () => {
  const { app } = createTestApp();
  const res = await app.inject({ method: "POST", url: "/api/sync", payload: { from: "banana", to: "2026-06-01" } });
  expect(res.statusCode).toBe(400);
});

test("/api/sync: two concurrent calls — the second gets 409 while the first is in flight", async () => {
  const { app, state } = createTestApp();
  state.syncInFlight = true; // simulate an in-flight sync without needing a real upstream call
  const res = await app.inject({ method: "POST", url: "/api/sync", payload: { from: "2026-06-01", to: "2026-06-02" } });
  expect(res.statusCode).toBe(409);
});

test("/api/sync: a cross-origin request is rejected", async () => {
  const { app } = createTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/sync",
    headers: { origin: "http://evil.example", host: "127.0.0.1:3000" },
    payload: { from: "2026-06-01", to: "2026-06-02" },
  });
  expect(res.statusCode).toBe(403);
});

// ---- /api/csv, /api/projects uploads (#16) ----

test("/api/csv: no file uploaded is a 400", async () => {
  const { app } = createTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/csv",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    payload: "--x--\r\n",
  });
  expect(res.statusCode).toBe(400);
});

test("/api/csv: a non-multipart body is a 400, not a 500", async () => {
  const { app } = createTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/csv",
    headers: { "content-type": "application/json" },
    payload: "{}",
  });
  expect(res.statusCode).toBe(400);
});

test("/api/csv: a non-.csv filename is a 400 before parsing", async () => {
  const { app } = createTestApp();
  const { body, headers } = multipartBody("attributes.txt", "email,Level\na@x.com,Senior\n");
  const res = await app.inject({ method: "POST", url: "/api/csv", headers, payload: body });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/\.csv/);
});

test("/api/csv: a well-formed upload succeeds", async () => {
  const { app, state } = createTestApp();
  const { body, headers } = multipartBody("attributes.csv", "email,Level\na@x.com,Senior\n");
  const res = await app.inject({ method: "POST", url: "/api/csv", headers, payload: body });
  expect(res.statusCode).toBe(200);
  expect(state.attributes.size).toBe(1);
});

test("/api/csv: a cross-origin upload is rejected", async () => {
  const { app } = createTestApp();
  const { body, headers } = multipartBody("attributes.csv", "email,Level\na@x.com,Senior\n");
  const res = await app.inject({
    method: "POST",
    url: "/api/csv",
    headers: { ...headers, origin: "http://evil.example", host: "127.0.0.1:3000" },
    payload: body,
  });
  expect(res.statusCode).toBe(403);
});

test("/api/projects: a non-.yaml filename is a 400 before parsing", async () => {
  const { app } = createTestApp();
  const { body, headers } = multipartBody("projects.txt", "projects: []", "text/plain");
  const res = await app.inject({ method: "POST", url: "/api/projects", headers, payload: body });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/\.ya?ml/);
});

test("/api/projects: a well-formed upload succeeds", async () => {
  const { app, state } = createTestApp();
  const { body, headers } = multipartBody(
    "projects.yaml",
    "projects:\n  - name: Acme\n    members:\n      - email: a@x.com\n        start: 2026-01-01\n",
    "application/x-yaml",
  );
  const res = await app.inject({ method: "POST", url: "/api/projects", headers, payload: body });
  expect(res.statusCode).toBe(200);
  expect(state.projectCount).toBe(1);
});
