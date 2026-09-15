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
  combineKeyers,
  attributesFor,
  buildOverview,
  buildOverviewFromUsers,
  createClient,
  CYCLE_DIMENSION_ID,
  cycleKeyer,
  cyclesFor,
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
  mergeFilterSpecs,
  parseAttributesCsv,
  parseFilterParam,
  parseProjectsYaml,
  timelineScopeSpec,
  resolveGroupBy as coreResolveGroupBy,
  resolveTimelineDimension,
  splitCombinedKey,
  scaleUserDayRow,
  scaleUserProductRow,
  summarizeMember,
  timelineDimensionId,
  timelineKeyer,
  TIMELINE_DIMENSION_LABELS,
  TIMELINE_FACETS,
  UNASSIGNED_KEY,
  type FilterSpec,
  type GroupRow,
  type GroupSelector,
  type RowKeyer,
  type TimelineFacet,
} from "@claude-analytics/core";
import type { FastifyReply } from "fastify";
import { AppState } from "./state.js";

const state = new AppState();
const app = Fastify({ logger: true });
await app.register(multipart);

/** One secondary-breakdown row: a normal GroupRow, keyed by the secondary
 *  value, tagged with which primary group it belongs to. */
type GroupRowWithPrimary = GroupRow & { primaryKey: string };

/** Resolve a `groupBy`/`secondary` query value (see core's resolveGroupBy for
 *  the shared resolution order); throws on an invalid value — every route
 *  that calls this already catches and 400s (see routeError). */
function resolveGroupBy(value: unknown): GroupSelector {
  const result = coreResolveGroupBy(state.attributes, state.memberships, value);
  if (result.ok) return result.selector;
  throw new Error(
    result.available.length
      ? `Invalid dimension "${result.invalidValue}". Available: ${result.available.join(", ")}.`
      : `No CSV or projects file loaded — upload one to group by attributes.`,
  );
}

/**
 * Resolve a `groupBy`/`secondary` value, additionally recognising the
 * reserved Cycle dimension — which, unlike every other dimension, needs to
 * know which ONE project is in scope before it can build a keyer (cycles are
 * per-project). `activeProjects` is the same cost-desc, no-Unassigned list
 * already computed for the Cycle-granularity chart's auto-unlock; requiring
 * it to have settled to exactly one project here keeps both features
 * consistent about what "in scope" means.
 */
function resolveDimensionKeyer(value: unknown, activeProjects: string[]): GroupSelector {
  if (
    String(value ?? "")
      .trim()
      .toLowerCase() === CYCLE_DIMENSION_ID
  ) {
    if (activeProjects.length !== 1) {
      throw new Error(
        activeProjects.length === 0
          ? "Cycle requires a single project in scope, but none has cost in range — pick one via Quick filter by."
          : `Cycle requires a single project in scope — ${activeProjects.length} are currently active (${activeProjects.join(", ")}). Narrow further with Quick filter by.`,
      );
    }
    return { id: CYCLE_DIMENSION_ID, keyer: cycleKeyer(cyclesFor(state.cycles, activeProjects[0]!)) };
  }
  return resolveGroupBy(value);
}

/** Projects with non-zero cost under the current scope/filter (cost-desc, no
 *  Unassigned) — drives both the web UI's Cycle-granularity auto-unlock and
 *  whether "Stacking by: Cycle" can be resolved (see resolveDimensionKeyer). */
function activeProjectsFor(
  userProducts: ReturnType<typeof state.db.getUserProducts>,
  product: string | undefined,
  spec: FilterSpec | null,
): string[] {
  if (state.memberships.size === 0) return [];
  return aggregateByKeyerOverTime(
    userProducts,
    applyTimelineFilterToKeyer(timelineKeyer(state.memberships, "project"), "@project", state.memberships, spec),
    product,
  ).keys.filter((k) => k !== UNASSIGNED_KEY);
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
 * Which timeline facet the `scope` param narrows: `scopeDimension` when given
 * (the "Quick filter by" control is independent of Group By/Stacking by), else
 * whichever facet the current `groupBy` resolves to (back-compat), else
 * "project" as the sensible default.
 */
function scopeFacetFor(scopeDimensionRaw: unknown, groupByRaw: unknown): TimelineFacet {
  return (
    resolveTimelineDimension(String(scopeDimensionRaw ?? "")) ??
    resolveTimelineDimension(String(groupByRaw ?? "")) ??
    "project"
  );
}

/**
 * Resolve a `scope` query value into a FilterSpec that hides every other
 * value of the relevant facet (see scopeFacetFor/timelineScopeSpec), merged
 * with the active member `filter` — union, not double-wrapping, so
 * cross-facet scaling never applies twice. Throws on an unknown value.
 */
function resolveTimelineScope(
  scopeValue: string | undefined,
  scopeDimensionRaw: unknown,
  groupByRaw: unknown,
  filterSpec: FilterSpec | null,
): FilterSpec | null {
  if (!scopeValue) return filterSpec;
  const facet = scopeFacetFor(scopeDimensionRaw, groupByRaw);
  const known = distinctFacetValues(state.memberships, facet);
  if (!known.includes(scopeValue)) {
    throw new Error(`Unknown ${TIMELINE_DIMENSION_LABELS[facet]} "${scopeValue}". Available: ${known.join(", ")}.`);
  }
  return mergeFilterSpecs(filterSpec, timelineScopeSpec(state.memberships, facet, scopeValue));
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

/** 400 a route with whatever message the caught error carries (or its string form). */
function routeError(reply: FastifyReply, err: unknown) {
  return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
}

type GroupQuery = RangeQuery & {
  product?: string;
  filter?: string;
  scope?: string;
  scopeDimension?: string;
  groupBy?: string;
};

interface ResolvedGroupQuery {
  from?: string;
  to?: string;
  product?: string;
  spec: FilterSpec | null;
  userProducts: ReturnType<typeof state.db.getUserProducts>;
  activeProjects: string[];
  selector: GroupSelector;
}

/**
 * Shared preamble for the three groupBy-driven routes (/api/groups,
 * /api/export, /api/export/groups-daily) — per #28, this is the
 * `resolveQuery`-style helper that replaces what used to be ~15 lines
 * independently repeated in each: parse+merge scope/filter into one
 * FilterSpec, fetch userProducts already filtered by the resulting email
 * predicate, compute activeProjects, and resolve the groupBy selector. Throws
 * on bad scope/filter/groupBy input — callers 400 it via routeError.
 */
function resolveGroupQuery(query: GroupQuery): ResolvedGroupQuery {
  const spec = resolveTimelineScope(query.scope, query.scopeDimension, query.groupBy, parseFilterParam(query.filter));
  const emailPred = emailPredicate(spec);
  const userProducts = state.db.getUserProducts({ from: query.from, to: query.to }).filter((r) => emailPred(r.email));
  const activeProjects = activeProjectsFor(userProducts, query.product, spec);
  const selector = resolveDimensionKeyer(query.groupBy, activeProjects);
  return { from: query.from, to: query.to, product: query.product, spec, userProducts, activeProjects, selector };
}

/**
 * Shared preamble for the two per-member export routes (/api/export/members,
 * /api/export/members-long): parse `filter`, fetch+scale userProducts by the
 * resulting per-row timeline weight, and list the (filtered) population of
 * known emails to seed rows for people with zero cost. Per #28.
 */
function resolveMemberRows(query: RangeQuery & { filter?: string }) {
  const spec = parseFilterParam(query.filter);
  const emailPred = emailPredicate(spec);
  const userProducts = scaleRows(
    state.db.getUserProducts({ from: query.from, to: query.to }).filter((r) => emailPred(r.email)),
    spec,
    scaleUserProductRow,
  );
  const emails = state.db.distinctEmails().filter((email) => emailPred(email));
  return { userProducts, emails };
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
  // Static cycle definitions per project (only those that declared any), for the
  // Groups page's Cycle granularity and the cycle annotations on all three tabs.
  const projectNames = distinctFacetValues(state.memberships, "project").filter((p) => p !== UNASSIGNED_KEY);
  const projectCycles = projectNames
    .map((project) => ({ project, cycles: cyclesFor(state.cycles, project) }))
    .filter((p) => p.cycles.length > 0);
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
    projectCycles,
    cycleCount: state.cycleCount,
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

app.get<{
  Querystring: RangeQuery & {
    groupBy?: string;
    secondary?: string;
    product?: string;
    filter?: string;
    scope?: string;
    scopeDimension?: string;
  };
}>("/api/groups", async (req, reply) => {
  let q: ResolvedGroupQuery;
  let secondarySelector: GroupSelector | null = null;
  try {
    q = resolveGroupQuery(req.query);
    if (req.query.secondary) secondarySelector = resolveDimensionKeyer(req.query.secondary, q.activeProjects);
  } catch (err) {
    return routeError(reply, err);
  }
  const userDays = state.db.getUserDays({ from: q.from, to: q.to }).filter((r) => emailPredicate(q.spec)(r.email));
  const keyer = filteredKeyer(q.selector, q.spec);
  const groups = aggregateByKeyer(q.userProducts, userDays, keyer, q.product);
  const { rows: timeseries, keys } = aggregateByKeyerOverTime(q.userProducts, keyer, q.product);
  const emails = new Set(state.db.distinctEmails());
  const unmatched = [...emails].filter((e) => !state.attributes.has(e));
  // A secondary (drill-down) breakdown of each primary group, for the totals
  // table only — e.g. Stacking by Team, table's Secondary by Member, to expand
  // a team's row and see who made it up. Doesn't touch the chart, which always
  // stacks by the primary ("Stacking by") dimension. Filtered independently
  // per dimension (via filteredKeyer) *before* combining, so
  // applyTimelineFilterToKeyer's same-facet-as-groupBy logic still sees each
  // keyer's own bare keys rather than a combined "primary<sep>secondary" string.
  let secondaryDimension: string | null = null;
  let secondaryGroups: GroupRowWithPrimary[] = [];
  if (secondarySelector) {
    const secondaryKeyer = filteredKeyer(secondarySelector, q.spec);
    const nested = aggregateByKeyer(q.userProducts, userDays, combineKeyers(keyer, secondaryKeyer), q.product);
    secondaryDimension = secondarySelector.id;
    secondaryGroups = nested.map((g) => {
      const { primary, secondary } = splitCombinedKey(g.key);
      return { ...g, key: secondary, primaryKey: primary };
    });
  }
  return {
    dimension: q.selector.id,
    product: q.product ?? null,
    groups,
    timeseries,
    keys,
    activeProjects: q.activeProjects,
    secondaryDimension,
    secondaryGroups,
    unmatchedCount: unmatched.length,
  };
});

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
  const summary = summarizeMember(
    state.db.getUserProducts({ from, to, email }),
    state.db.getUserDays({ from, to, email }),
    email,
    attributesFor(state.attributes, email),
  );
  // Which project(s) this person overlapped with in range — lets the Members
  // chart draw that project's cycles (bands if exactly one, else a lane per
  // project). Same "overlap" approximation as /api/users; not used for money.
  const range = state.db.dateRange();
  const projects = state.memberships.size
    ? activeFacetKeysInRange(
        state.memberships,
        email,
        from ?? range?.min ?? "0000-01-01",
        to ?? range?.max ?? "9999-12-31",
        "project",
      ).filter((p) => p !== UNASSIGNED_KEY)
    : [];
  return { ...summary, projects };
});

app.get<{
  Querystring: RangeQuery & {
    groupBy?: string;
    product?: string;
    filter?: string;
    scope?: string;
    scopeDimension?: string;
  };
}>("/api/export", async (req, reply) => {
  let q: ResolvedGroupQuery;
  try {
    q = resolveGroupQuery(req.query);
  } catch (err) {
    return routeError(reply, err);
  }
  const userDays = state.db.getUserDays({ from: q.from, to: q.to }).filter((r) => emailPredicate(q.spec)(r.email));
  const keyer = filteredKeyer(q.selector, q.spec);
  const groups = aggregateByKeyer(q.userProducts, userDays, keyer, q.product);
  return reply
    .header("Content-Type", "text/csv")
    .header("Content-Disposition", `attachment; filename="by-${q.selector.id.replace(/^@/, "")}.csv"`)
    .send(groupsToCsv(groups, q.selector.id));
});

app.get<{
  Querystring: RangeQuery & {
    groupBy?: string;
    product?: string;
    filter?: string;
    scope?: string;
    scopeDimension?: string;
  };
}>("/api/export/groups-daily", async (req, reply) => {
  let q: ResolvedGroupQuery;
  try {
    q = resolveGroupQuery(req.query);
  } catch (err) {
    return routeError(reply, err);
  }
  const keyer = filteredKeyer(q.selector, q.spec);
  const { rows } = aggregateByKeyerOverTime(q.userProducts, keyer, q.product);
  return reply
    .header("Content-Type", "text/csv")
    .header("Content-Disposition", `attachment; filename="by-${q.selector.id.replace(/^@/, "")}-daily.csv"`)
    .send(groupsDailyToCsv(rows, q.selector.id));
});

app.get<{ Querystring: RangeQuery & { filter?: string } }>("/api/export/members", async (req, reply) => {
  // Population is everyone Claude knows about (analytics emails); CSV attributes
  // are joined where they match and left blank where they don't.
  const { userProducts, emails } = resolveMemberRows(req.query);
  const { rows, dates } = membersDailyCost(userProducts, state.attributes, emails);
  return reply
    .header("Content-Type", "text/csv")
    .header("Content-Disposition", `attachment; filename="members.csv"`)
    .send(membersDailyToCsv(rows, dates, dimensionsOf(state.attributes)));
});

app.get<{ Querystring: RangeQuery & { filter?: string } }>("/api/export/members-long", async (req, reply) => {
  const { userProducts, emails } = resolveMemberRows(req.query);
  const { rows, dates } = membersDailyCost(userProducts, state.attributes, emails);
  return reply
    .header("Content-Type", "text/csv")
    .header("Content-Disposition", `attachment; filename="members-daily.csv"`)
    .send(membersDailyLongToCsv(rows, dates));
});

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
    const result = parseProjectsYaml(text);
    state.setProjects(result, `upload: ${file.filename} (${result.projectCount} project(s))`);
    return {
      ok: true,
      projects: result.projectCount,
      members: result.memberCount,
      cycles: result.cycleCount,
      warnings: result.warnings,
      source: state.projectsSource,
    };
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
