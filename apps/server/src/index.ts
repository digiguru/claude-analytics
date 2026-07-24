import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  aggregateByDimension,
  attributesFor,
  buildOverview,
  buildOverviewFromUsers,
  createClient,
  dimensionsOf,
  fetchRange,
  groupsToCsv,
  isEmptyFilter,
  makeEmailFilter,
  membersDailyCost,
  membersDailyToCsv,
  membersDailyLongToCsv,
  parseAttributesCsv,
  parseFilterParam,
  resolveDimension,
  summarizeMember,
  type Dimension,
} from "@claude-analytics/core";
import { AppState } from "./state.js";

const state = new AppState();
const app = Fastify({ logger: true });
await app.register(multipart);

function asDimension(value: unknown): Dimension {
  const dims = dimensionsOf(state.attributes);
  const dim = resolveDimension(state.attributes, String(value ?? ""));
  if (!dim) {
    throw new Error(
      dims.length
        ? `Invalid dimension "${value}". Available columns: ${dims.join(", ")}.`
        : `No CSV loaded — upload one (with an "email" column) to group by attributes.`,
    );
  }
  return dim;
}

interface RangeQuery {
  from?: string;
  to?: string;
}

/** Member predicate built from the optional `filter` query param. */
function emailPredicate(raw: string | undefined): (email: string) => boolean {
  return makeEmailFilter(state.attributes, parseFilterParam(raw));
}

app.get("/api/status", async () => {
  const range = state.db.dateRange();
  return {
    csvLoaded: state.attributes.size > 0,
    csvSource: state.csvSource,
    csvRows: state.attributes.size,
    dimensions: dimensionsOf(state.attributes),
    cachedDateRange: range,
    developerCount: state.db.distinctEmails().length,
    apiKeyConfigured: Boolean(state.config.apiKey),
  };
});

app.post<{ Body: { from?: string; to?: string } }>("/api/sync", async (req, reply) => {
  const { from, to } = req.body ?? {};
  if (!from || !to) return reply.code(400).send({ error: "Body must include 'from' and 'to' (YYYY-MM-DD)." });
  try {
    const client = createClient(state.config.apiKey);
    const result = await fetchRange(client, state.db, from, to);
    return { ok: true, ...result };
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get<{ Querystring: RangeQuery & { filter?: string } }>("/api/overview", async (req) => {
  const { from, to, filter } = req.query;
  const spec = parseFilterParam(filter);
  if (isEmptyFilter(spec)) {
    return { ...buildOverview(state.db.getSummaries(from, to), state.db.getOrgProducts(from, to)), filtered: false };
  }
  // With a member filter active, rebuild cost/tokens/active-users from per-user rows.
  const pred = makeEmailFilter(state.attributes, spec);
  const userProducts = state.db.getUserProducts({ from, to }).filter((r) => pred(r.email));
  const userDays = state.db.getUserDays({ from, to }).filter((r) => pred(r.email));
  return { ...buildOverviewFromUsers(userProducts, userDays), filtered: true };
});

app.get<{ Querystring: RangeQuery & { groupBy?: string; product?: string; filter?: string } }>(
  "/api/groups",
  async (req, reply) => {
    let dimension: Dimension;
    try {
      dimension = asDimension(req.query.groupBy);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const { from, to, product, filter } = req.query;
    const pred = emailPredicate(filter);
    const groups = aggregateByDimension(
      state.db.getUserProducts({ from, to }).filter((r) => pred(r.email)),
      state.db.getUserDays({ from, to }).filter((r) => pred(r.email)),
      state.attributes,
      dimension,
      product,
    );
    const emails = new Set(state.db.distinctEmails());
    const unmatched = [...emails].filter((e) => !state.attributes.has(e));
    return { dimension, product: product ?? null, groups, unmatchedCount: unmatched.length };
  },
);

app.get("/api/users", async () => {
  return {
    users: state.db.distinctEmails().map((email) => ({
      email,
      attributes: state.attributes.get(email) ?? null,
    })),
  };
});

app.get<{ Params: { email: string }; Querystring: RangeQuery }>("/api/members/:email", async (req) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const { from, to } = req.query;
  return summarizeMember(
    state.db.getUserProducts({ from, to, email }),
    state.db.getUserDays({ from, to, email }),
    email,
    attributesFor(state.attributes, email),
  );
});

app.get<{ Querystring: RangeQuery & { groupBy?: string; product?: string; filter?: string } }>(
  "/api/export",
  async (req, reply) => {
    let dimension: Dimension;
    try {
      dimension = asDimension(req.query.groupBy);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const { from, to, product, filter } = req.query;
    const pred = emailPredicate(filter);
    const groups = aggregateByDimension(
      state.db.getUserProducts({ from, to }).filter((r) => pred(r.email)),
      state.db.getUserDays({ from, to }).filter((r) => pred(r.email)),
      state.attributes,
      dimension,
      product,
    );
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="by-${dimension}.csv"`)
      .send(groupsToCsv(groups, dimension));
  },
);

app.get<{ Querystring: RangeQuery & { filter?: string } }>(
  "/api/export/members",
  async (req, reply) => {
    const { from, to, filter } = req.query;
    const pred = emailPredicate(filter);
    const userProducts = state.db.getUserProducts({ from, to }).filter((r) => pred(r.email));
    // Population is everyone Claude knows about (analytics emails); CSV attributes
    // are joined where they match and left blank where they don't.
    const emails = state.db.distinctEmails().filter((email) => pred(email));
    const { rows, dates } = membersDailyCost(userProducts, state.attributes, emails);
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="members.csv"`)
      .send(membersDailyToCsv(rows, dates, dimensionsOf(state.attributes)));
  },
);

app.get<{ Querystring: RangeQuery & { filter?: string } }>(
  "/api/export/members-long",
  async (req, reply) => {
    const { from, to, filter } = req.query;
    const pred = emailPredicate(filter);
    const userProducts = state.db.getUserProducts({ from, to }).filter((r) => pred(r.email));
    const emails = state.db.distinctEmails().filter((email) => pred(email));
    const { rows, dates } = membersDailyCost(userProducts, state.attributes, emails);
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="members-daily.csv"`)
      .send(membersDailyLongToCsv(rows, dates));
  },
);

app.post("/api/csv", async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "No file uploaded (field name: 'file')." });
  const text = (await file.toBuffer()).toString("utf8");
  try {
    const { attributes, count } = parseAttributesCsv(text);
    state.setAttributes(attributes, `upload: ${file.filename} (${count} rows)`);
    return { ok: true, rows: count, source: state.csvSource };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Serve the built web app (production).
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"),
  );
} else {
  app.log.info("web/dist not found — run 'npm run build:web' for the bundled UI (dev uses Vite).");
}

const { port } = state.config;
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`Claude Analytics server on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
