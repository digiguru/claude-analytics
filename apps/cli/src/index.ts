#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import {
  aggregateByKeyer,
  attributesFor,
  buildOverview,
  createClient,
  csvKeyer,
  cyclesFor,
  dimensionsOf,
  fetchRange,
  groupsToCsv,
  loadAttributesCsv,
  loadProjectsYaml,
  MetricsDb,
  rankUsers,
  resolveDimension,
  resolveTimelineDimension,
  summarizeMember,
  timelineDimensionId,
  timelineKeyer,
  TIMELINE_DIMENSION_LABELS,
  TIMELINE_FACETS,
  type AttributeMap,
  type Attributes,
  type MembershipIndex,
  type ProjectsParseResult,
  type RowKeyer,
} from "@claude-analytics/core";
import { loadConfig } from "./config.js";

const program = new Command();
program
  .name("claude-analytics")
  .description("Query the Claude Enterprise Analytics API and join it to a developer CSV.")
  .version("0.2.0");

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
/** "2026-06-10" -> "Wed 10th Jun" (UTC). */
function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${WEEKDAYS[d.getUTCDay()]} ${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}
const tk = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function openDb(): MetricsDb {
  return new MetricsDb(loadConfig().dbPath);
}

function loadCsv(override?: string): AttributeMap {
  const path = override ?? loadConfig().csvPath;
  if (!path) {
    console.error("No CSV provided. Pass --csv <path> or set CSV_PATH in .env to group by attributes.");
    return new Map();
  }
  return loadAttributesCsv(path).attributes;
}

/** Like loadCsv but silent when no CSV is configured (attributes are optional). */
function loadCsvOptional(override?: string): AttributeMap {
  const path = override ?? loadConfig().csvPath;
  if (!path) return new Map();
  try {
    return loadAttributesCsv(path).attributes;
  } catch {
    return new Map();
  }
}

/** A short human label from whatever attributes a CSV happens to carry. */
const attrLabel = (a: Attributes | null): string => {
  if (!a) return "no CSV match";
  const vals = Object.values(a).filter((v) => v && v.trim());
  return vals.length ? vals.slice(0, 3).join(" · ") : "no attributes";
};

/** Load the projects/teams YAML, or an empty index when none is configured. */
function loadProjectsOptional(override?: string): MembershipIndex {
  const path = override ?? loadConfig().projectsPath;
  if (!path) return new Map();
  try {
    return loadProjectsYaml(path).index;
  } catch {
    return new Map();
  }
}

interface GroupSelector {
  id: string;
  keyer: RowKeyer;
}

/** Resolve --group-by against the timeline facets (@project/@team/@client) first,
 *  then the columns actually present in the CSV, or exit. */
function resolveGroupBy(attributes: AttributeMap, memberships: MembershipIndex, value: string): GroupSelector {
  const facet = resolveTimelineDimension(value);
  if (facet) return { id: timelineDimensionId(facet), keyer: timelineKeyer(memberships, facet) };

  const dims = dimensionsOf(attributes);
  const dim = resolveDimension(attributes, value);
  if (dim) return { id: dim, keyer: csvKeyer(attributes, dim) };

  const timelineIds = TIMELINE_FACETS.map(timelineDimensionId);
  const available = [...timelineIds, ...dims];
  if (available.length === 0) {
    console.error(
      "No CSV attributes or projects file loaded. Pass --csv/--projects or set CSV_PATH/PROJECTS_PATH in .env.",
    );
  } else {
    console.error(`Invalid --group-by "${value}". Available: ${available.join(", ")}.`);
  }
  process.exit(1);
}

program
  .command("sync")
  .description("Fetch all analytics (summaries, activity, cost, usage) for a date range.")
  .requiredOption("--from <date>", "start day (YYYY-MM-DD, UTC, inclusive)")
  .requiredOption("--to <date>", "end day (YYYY-MM-DD, UTC, inclusive)")
  .action(async (opts: { from: string; to: string }) => {
    const client = createClient(loadConfig().apiKey);
    const db = openDb();
    try {
      const r = await fetchRange(client, db, opts.from, opts.to, (p) => console.log(`  [${p.step}] ${p.detail}`));
      console.log(
        `\nSynced ${r.effectiveRange.from}..${r.effectiveRange.to}: ` +
          `${r.summaryDays} summary day(s), ${r.activityDays} activity day(s), ` +
          `${r.userProductRows} user×product row(s), ${r.orgProductRows} org×product row(s).`,
      );
      if (r.unparseableAmounts > 0) {
        console.warn(
          `  WARNING: ${r.unparseableAmounts} cost amount(s) failed to parse and were recorded as $0. ` +
            `Cost totals for this sync may be understated.`,
        );
      }
    } finally {
      db.close();
    }
  });

program
  .command("overview")
  .description("Org-wide cost, usage, adoption, and heaviest days.")
  .option("--from <date>")
  .option("--to <date>")
  .option("--csv <path>", "attributes CSV (for top-user labels; overrides CSV_PATH)")
  .action((opts: { from?: string; to?: string; csv?: string }) => {
    const db = openDb();
    try {
      const ov = buildOverview(db.getSummaries(opts.from, opts.to), db.getOrgProducts(opts.from, opts.to));
      if (ov.timeseries.length === 0) {
        console.log('No cached data. Run "sync" for the date range first.');
        return;
      }
      console.log(`\nTotal cost: ${usd(ov.totalCostCents)} · total tokens: ${tk(ov.totalTokens)}\n`);
      console.log("Cost by product:");
      console.table(
        ov.productTotals.map((p) => ({ product: p.product, cost: usd(p.costCents), tokens: tk(p.totalTokens) })),
      );
      console.log("\nHeaviest days (by cost):");
      console.table(ov.heaviestDays.slice(0, 5).map((d) => ({ date: formatDay(d.date), cost: usd(d.costCents) })));

      const top = rankUsers(db.getUserProducts({ from: opts.from, to: opts.to }), loadCsvOptional(opts.csv), {
        by: "cost",
        limit: 5,
      });
      console.log("\nTop 5 users (by cost):");
      console.table(
        top.map((u) => ({
          user: u.email,
          who: attrLabel(u.attributes),
          cost: usd(u.costCents),
          tokens: tk(u.totalTokens),
        })),
      );
    } finally {
      db.close();
    }
  });

program
  .command("top")
  .description("Rank individual users by cost or tokens.")
  .option("--by <metric>", "cost or tokens", "cost")
  .option("--limit <n>", "number of users", "10")
  .option("--from <date>")
  .option("--to <date>")
  .option("--csv <path>", "attributes CSV (overrides CSV_PATH)")
  .action((opts: { by?: string; limit?: string; from?: string; to?: string; csv?: string }) => {
    const by = opts.by === "tokens" ? "tokens" : "cost";
    const limit = Math.max(1, Number.parseInt(opts.limit ?? "10", 10) || 10);
    const db = openDb();
    try {
      const ranked = rankUsers(db.getUserProducts({ from: opts.from, to: opts.to }), loadCsvOptional(opts.csv), {
        by,
        limit,
      });
      if (ranked.length === 0) {
        console.log('No cached data. Run "sync" first.');
        return;
      }
      console.log(`\nTop ${ranked.length} users by ${by}:\n`);
      console.table(
        ranked.map((u, i) => ({
          "#": i + 1,
          user: u.email,
          who: attrLabel(u.attributes),
          cost: usd(u.costCents),
          tokens: tk(u.totalTokens),
          requests: u.requests,
        })),
      );
    } finally {
      db.close();
    }
  });

program
  .command("columns")
  .description("List the columns (dimensions) available to group by (CSV columns + timeline facets).")
  .option("--csv <path>", "attributes CSV (overrides CSV_PATH)")
  .option("--projects <path>", "projects YAML (overrides PROJECTS_PATH)")
  .action((opts: { csv?: string; projects?: string }) => {
    const attributes = loadCsvOptional(opts.csv);
    const memberships = loadProjectsOptional(opts.projects);
    const dims = dimensionsOf(attributes);
    if (memberships.size) {
      console.log("\nTimeline (from your projects file):\n");
      for (const facet of TIMELINE_FACETS)
        console.log(`  - ${timelineDimensionId(facet)}  (${TIMELINE_DIMENSION_LABELS[facet]})`);
    }
    if (dims.length === 0 && memberships.size === 0) {
      console.log(
        "No CSV attributes or projects file loaded. Pass --csv/--projects or set CSV_PATH/PROJECTS_PATH in .env.",
      );
      return;
    }
    if (dims.length) {
      console.log(`\n${attributes.size} developer row(s). Group by any CSV column:\n`);
      for (const d of dims) console.log(`  - ${d}`);
    }
    const example = memberships.size ? timelineDimensionId("project") : dims[0];
    console.log(`\ne.g. npm run cli -- group --group-by ${example}`);
  });

program
  .command("group")
  .description("Aggregate usage/cost/activity by any CSV column or timeline facet (run 'columns' to list them).")
  .requiredOption("--group-by <dimension>", "a CSV column, or @project/@team/@client")
  .option("--from <date>")
  .option("--to <date>")
  .option("--product <product>", "restrict cost/tokens to one product")
  .option("--csv <path>", "attributes CSV (overrides CSV_PATH)")
  .option("--projects <path>", "projects YAML (overrides PROJECTS_PATH)")
  .action(
    (opts: { groupBy: string; from?: string; to?: string; product?: string; csv?: string; projects?: string }) => {
      const db = openDb();
      try {
        const attributes = loadCsvOptional(opts.csv);
        const memberships = loadProjectsOptional(opts.projects);
        const selector = resolveGroupBy(attributes, memberships, opts.groupBy);
        const groups = aggregateByKeyer(
          db.getUserProducts({ from: opts.from, to: opts.to }),
          db.getUserDays({ from: opts.from, to: opts.to }),
          selector.keyer,
          opts.product,
        );
        console.log(`\nUsage by ${selector.id}${opts.product ? ` (product: ${opts.product})` : ""}:\n`);
        console.table(
          groups.map((g) => ({
            [selector.id]: g.key,
            seats: g.seats,
            active: g.activeUsers,
            "active days": g.activeUserDays.toFixed(1),
            cost: usd(g.costCents),
            "$/seat": usd(g.avgCostPerSeat),
            "$/active": usd(g.avgCostPerActiveUser),
            tokens: tk(g.totalTokens),
            "tok/active": tk(Math.round(g.avgTokensPerActiveUser)),
            "cc sess": g.ccSessions.toFixed(1),
            "sess/active": g.activeUsers ? (g.ccSessions / g.activeUsers).toFixed(1) : "0",
            "chat msgs": g.chatMessages.toFixed(1),
            "web srch": g.webSearches.toFixed(1),
          })),
        );
      } finally {
        db.close();
      }
    },
  );

program
  .command("member")
  .description("One developer's usage across all products.")
  .argument("<email>")
  .option("--from <date>")
  .option("--to <date>")
  .option("--csv <path>")
  .action((email: string, opts: { from?: string; to?: string; csv?: string }) => {
    const db = openDb();
    try {
      const attrs = attributesFor(loadCsv(opts.csv), email);
      const m = summarizeMember(
        db.getUserProducts({ from: opts.from, to: opts.to, email }),
        db.getUserDays({ from: opts.from, to: opts.to, email }),
        email,
        attrs,
      );
      if (m.daily.length === 0) {
        console.log(`No cached metrics for ${email}. Run "sync" first.`);
        return;
      }
      console.log(`\n${m.email}${attrs ? ` — ${attrLabel(attrs)}` : ""}`);
      console.log(
        `Active days: ${m.activeDays} · cost: ${usd(m.totalCostCents)} · tokens: ${tk(m.totalTokens)} · ` +
          `chat: ${m.chatMessages} · cc sessions: ${m.ccSessions} · cc loc+: ${m.ccLocAdded} · web: ${m.webSearches}\n`,
      );
      console.log("Cost by product:");
      console.table(Object.entries(m.costByProduct).map(([product, cents]) => ({ product, cost: usd(cents) })));
    } finally {
      db.close();
    }
  });

program
  .command("export")
  .description("Write a grouped view to CSV.")
  .requiredOption("--group-by <dimension>", "a CSV column, or @project/@team/@client")
  .requiredOption("--out <file>")
  .option("--from <date>")
  .option("--to <date>")
  .option("--product <product>")
  .option("--csv <path>")
  .option("--projects <path>", "projects YAML (overrides PROJECTS_PATH)")
  .action(
    (opts: {
      groupBy: string;
      out: string;
      from?: string;
      to?: string;
      product?: string;
      csv?: string;
      projects?: string;
    }) => {
      const db = openDb();
      try {
        const attributes = loadCsvOptional(opts.csv);
        const memberships = loadProjectsOptional(opts.projects);
        const selector = resolveGroupBy(attributes, memberships, opts.groupBy);
        const groups = aggregateByKeyer(
          db.getUserProducts({ from: opts.from, to: opts.to }),
          db.getUserDays({ from: opts.from, to: opts.to }),
          selector.keyer,
          opts.product,
        );
        writeFileSync(opts.out, groupsToCsv(groups, selector.id));
        console.log(`Wrote ${groups.length} group(s) to ${opts.out}.`);
      } finally {
        db.close();
      }
    },
  );

program
  .command("projects")
  .description("Load and validate the projects/teams YAML — lists every project, its cycles, and any warnings.")
  .option("--projects <path>", "projects YAML (overrides PROJECTS_PATH)")
  .option("--project <name>", "only show this project's cycles")
  .action((opts: { projects?: string; project?: string }) => {
    const path = opts.projects ?? loadConfig().projectsPath;
    if (!path) {
      console.log("No projects file configured. Pass --projects <path> or set PROJECTS_PATH in .env.");
      return;
    }
    let result: ProjectsParseResult;
    try {
      result = loadProjectsYaml(path);
    } catch (err) {
      console.error(`Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    const { index, cycles, projectCount, memberCount, cycleCount, warnings } = result;
    if (projectCount === 0) {
      console.log(`No projects found in ${path}.`);
      return;
    }
    // Flatten memberships back out by project for a per-project summary.
    const byProject = new Map<
      string,
      { team: string; client: string; members: number; start: string; end: string | null }
    >();
    for (const list of index.values()) {
      for (const m of list) {
        let p = byProject.get(m.project);
        if (!p)
          byProject.set(m.project, (p = { team: m.team, client: m.client, members: 0, start: m.start, end: m.end }));
        p.members += 1;
        if (m.start < p.start) p.start = m.start;
        if (p.end !== null && (m.end === null || m.end > p.end)) p.end = m.end;
      }
    }
    console.log(`\n${path}: ${projectCount} project(s), ${memberCount} membership(s), ${cycleCount} cycle(s).\n`);
    console.table(
      [...byProject.entries()].map(([project, p]) => ({
        project,
        team: p.team,
        client: p.client,
        members: p.members,
        cycles: cycles.get(project)?.length ?? 0,
        from: p.start,
        to: p.end ?? "(ongoing)",
      })),
    );

    if (cycleCount > 0) {
      const projectNames = opts.project ? [opts.project] : [...cycles.keys()];
      const rows = projectNames.flatMap((project) =>
        cyclesFor(cycles, project).map((c) => ({
          project,
          cycle: c.name,
          from: c.start,
          to: c.end === null ? "(ongoing)" : c.derivedEnd ? `${c.end} (→ next)` : c.end,
        })),
      );
      if (rows.length) {
        console.log(`\nCycles${opts.project ? ` — ${opts.project}` : ""}:\n`);
        console.table(rows);
      } else if (opts.project) {
        console.log(`\nNo cycles found for "${opts.project}".`);
      }
    }

    if (warnings.length) {
      console.log(`\n${warnings.length} warning(s):`);
      for (const w of warnings) console.log(`  - ${w}`);
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
