import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  activeFacetKeysInRange,
  aggregateByKeyer,
  aggregateByKeyerOverTime,
  applyTimelineFilterToKeyer,
  attributesFor,
  buildOverview,
  buildOverviewFromUsers,
  createClient,
  csvKeyer,
  dimensionsOf,
  distinctFacetValues,
  fetchRange,
  groupsDailyToCsv,
  groupsToCsv,
  isEmptyFilter,
  makeEmailFilter,
  makeRowWeight,
  membersDailyCost,
  membersDailyToCsv,
  membersDailyLongToCsv,
  parseAttributesCsv,
  parseFilterParam,
  parseProjectsYaml,
  resolveDimension,
  resolveTimelineDimension,
  scaleUserDayRow,
  scaleUserProductRow,
  summarizeMember,
  timelineDimensionId,
  timelineKeyer,
  TIMELINE_DIMENSION_LABELS,
  TIMELINE_FACETS,
  type FilterSpec,
  type RowKeyer,
} from "@claude-analytics/core";
import { AppState } from "./state.js";

const state = new AppState();
const app = Fastify({ logger: true });
await app.register(multipart);

/** A resolved Group By selection: its canonical id (CSV column name, or "@project" etc.) and keyer. */
interface GroupSelector {
  id: string;
  keyer: RowKeyer;
}

/** Resolve a `groupBy` query value against the timeline facets first, then CSV columns. */
function resolveGroupBy(value: unknown): GroupSelector {
  const raw = String(value ?? "");
  const facet = resolveTimelineDimension(raw);
  if (facet) return { id: timelineDimensionId(facet), keyer: timelineKeyer(state.memberships, facet) };

  const dims = dimensionsOf(state.attributes);
  const dim = resolveDimension(state.attributes, raw);
  if (dim) return { id: dim, keyer: csvKeyer(state.attributes, dim) };

  const timelineIds = TIMELINE_FACETS.map(timelineDimensionId);
  const available = [...timelineIds, ...dims];
  throw new Error(
    available.length
      ? `Invalid dimension "${value}". Available: ${available.join(", ")}.`
      : `No CSV or projects file loaded — upload one to group by attributes.`,
  );
}

interface RangeQuery {
  from?: string;
  to?: string;
}

/** Member predicate (email-only, CSV facets + explicit email hides) built from the `filter` param. */
function emailPredicate(spec: FilterSpec | null): (email: string) => boolean {
  return makeEmailFilter(state.attributes, spec);
}

/**
 * Group-by-aware keyer: the CSV/timeline keyer for `selector`, with any hidden
 * timeline values excluded per {@link applyTimelineFilterToKeyer}'s rules (same
 * facet as the groupBy -> dropped outright; a different timeline facet ->
 * scaled by that day's kept fraction). Used by /api/groups and /api/export.
 */
function filteredKeyer(selector: GroupSelector, spec: FilterSpec | null): RowKeyer {
  return applyTimelineFilterToKeyer(selector.keyer, selector.id, state.memberships, spec);
}

/**
 * Scale raw userProducts/userDays rows by a filter's per-row timeline weight —
 * for contexts with no groupBy keyer to hide entries from (the overview,
 * member exports). Rows already excluded by the email predicate should be
 * filtered out first.
 */
function scaleRows<T extends { email: string; date: string }>(
  rows: T[],
  spec: FilterSpec | null,
  scale: (r: T, weight: number) => T,
): T[] {
  const weightOf = makeRowWeight(state.memberships, spec);
  const out: T[] = [];
  for (const r of rows) {
    const w = weightOf(r.email, r.date);
    if (w > 0) out.push(scale(r, w));
  }
  return out;
}

app.get("/api/status", async () => {
  const range = state.db.dateRange();
  const timelineDimensions = state.memberships.size
    ? TIMELINE_FACETS.map((facet) => ({
        id: timelineDimensionId(facet),
        label: TIMELINE_DIMENSION_LABELS[facet],
        values: distinctFacetValues(state.memberships, facet),
      }))
    : [];
  return {
    csvLoaded: state.attributes.size > 0,
    csvSource: state.csvSource,
    csvRows: state.attributes.size,
    dimensions: dimensionsOf(state.attributes),
    projectsLoaded: state.memberships.size > 0,
    projectsSource: state.projectsSource,
    projectCount: state.projectCount,
    projectWarnings: state.projectWarnings,
    timelineDimensions,
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
  // With a member/timeline filter active, rebuild cost/tokens/active-users from
  // per-user rows: drop rows for hidden emails outright, then shave off each
  // remaining row's hidden-timeline share (see makeRowWeight).
  const emailPred = emailPredicate(spec);
  const userProducts = scaleRows(
    state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email)),
    spec,
    scaleUserProductRow,
  );
  const userDays = scaleRows(
    state.db.getUserDays({ from, to }).filter((r) => emailPred(r.email)),
    spec,
    scaleUserDayRow,
  );
  return { ...buildOverviewFromUsers(userProducts, userDays), filtered: true };
});

app.get<{ Querystring: RangeQuery & { groupBy?: string; product?: string; filter?: string } }>(
  "/api/groups",
  async (req, reply) => {
    let selector: GroupSelector;
    try {
      selector = resolveGroupBy(req.query.groupBy);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const { from, to, product, filter } = req.query;
    const spec = parseFilterParam(filter);
    const emailPred = emailPredicate(spec);
    const keyer = filteredKeyer(selector, spec);
    const userProducts = state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email));
    const userDays = state.db.getUserDays({ from, to }).filter((r) => emailPred(r.email));
    const groups = aggregateByKeyer(userProducts, userDays, keyer, product);
    const { rows: timeseries, keys } = aggregateByKeyerOverTime(userProducts, keyer, product);
    const emails = new Set(state.db.distinctEmails());
    const unmatched = [...emails].filter((e) => !state.attributes.has(e));
    return { dimension: selector.id, product: product ?? null, groups, timeseries, keys, unmatchedCount: unmatched.length };
  },
);

app.get<{ Querystring: RangeQuery }>("/api/users", async (req) => {
  const { from, to } = req.query;
  // When a projects file is loaded, also report each user's approximate timeline
  // group membership over the queried range (or the whole cache when unset), so
  // the Members tab's filter can apply Project/Team/Client facets too. This is
  // "did any membership overlap the range at all" — a list-membership convenience,
  // not the day-by-day split used for cost (see makeRowWeight/applyTimelineFilterToKeyer).
  const hasTimeline = state.memberships.size > 0;
  const range = state.db.dateRange();
  const rangeFrom = from ?? range?.min ?? "0000-01-01";
  const rangeTo = to ?? range?.max ?? "9999-12-31";
  return {
    users: state.db.distinctEmails().map((email) => ({
      email,
      attributes: state.attributes.get(email) ?? null,
      groups: hasTimeline
        ? {
            "@project": activeFacetKeysInRange(state.memberships, email, rangeFrom, rangeTo, "project"),
            "@team": activeFacetKeysInRange(state.memberships, email, rangeFrom, rangeTo, "team"),
            "@client": activeFacetKeysInRange(state.memberships, email, rangeFrom, rangeTo, "client"),
          }
        : undefined,
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
    let selector: GroupSelector;
    try {
      selector = resolveGroupBy(req.query.groupBy);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const { from, to, product, filter } = req.query;
    const spec = parseFilterParam(filter);
    const emailPred = emailPredicate(spec);
    const keyer = filteredKeyer(selector, spec);
    const groups = aggregateByKeyer(
      state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email)),
      state.db.getUserDays({ from, to }).filter((r) => emailPred(r.email)),
      keyer,
      product,
    );
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="by-${selector.id.replace(/^@/, "")}.csv"`)
      .send(groupsToCsv(groups, selector.id));
  },
);

app.get<{ Querystring: RangeQuery & { groupBy?: string; product?: string; filter?: string } }>(
  "/api/export/groups-daily",
  async (req, reply) => {
    let selector: GroupSelector;
    try {
      selector = resolveGroupBy(req.query.groupBy);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const { from, to, product, filter } = req.query;
    const spec = parseFilterParam(filter);
    const emailPred = emailPredicate(spec);
    const keyer = filteredKeyer(selector, spec);
    const { rows } = aggregateByKeyerOverTime(
      state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email)),
      keyer,
      product,
    );
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="by-${selector.id.replace(/^@/, "")}-daily.csv"`)
      .send(groupsDailyToCsv(rows, selector.id));
  },
);

app.get<{ Querystring: RangeQuery & { filter?: string } }>(
  "/api/export/members",
  async (req, reply) => {
    const { from, to, filter } = req.query;
    const spec = parseFilterParam(filter);
    const emailPred = emailPredicate(spec);
    const userProducts = scaleRows(
      state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email)),
      spec,
      scaleUserProductRow,
    );
    // Population is everyone Claude knows about (analytics emails); CSV attributes
    // are joined where they match and left blank where they don't.
    const emails = state.db.distinctEmails().filter((email) => emailPred(email));
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
    const spec = parseFilterParam(filter);
    const emailPred = emailPredicate(spec);
    const userProducts = scaleRows(
      state.db.getUserProducts({ from, to }).filter((r) => emailPred(r.email)),
      spec,
      scaleUserProductRow,
    );
    const emails = state.db.distinctEmails().filter((email) => emailPred(email));
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

app.post("/api/projects", async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "No file uploaded (field name: 'file')." });
  const text = (await file.toBuffer()).toString("utf8");
  try {
    const { index, projectCount, memberCount, warnings } = parseProjectsYaml(text);
    state.setMemberships(index, projectCount, warnings, `upload: ${file.filename} (${projectCount} project(s))`);
    return { ok: true, projects: projectCount, members: memberCount, warnings, source: state.projectsSource };
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
