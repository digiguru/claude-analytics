#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import {
  aggregateByDimension,
  attributesFor,
  buildOverview,
  createClient,
  dimensionsOf,
  fetchRange,
  groupsToCsv,
  loadAttributesCsv,
  MetricsDb,
  rankUsers,
  resolveDimension,
  summarizeMember,
  type AttributeMap,
  type Attributes,
  type Dimension,
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

/** Resolve --group-by against the columns actually present in the CSV, or exit. */
function resolveDim(attributes: AttributeMap, value: string): Dimension {
  const dims = dimensionsOf(attributes);
  if (dims.length === 0) {
    console.error("No CSV attributes loaded. Pass --csv <path> or set CSV_PATH in .env.");
    process.exit(1);
  }
  const dim = resolveDimension(attributes, value);
  if (!dim) {
    console.error(`Invalid --group-by "${value}". Available columns: ${dims.join(", ")}.`);
    process.exit(1);
  }
  return dim;
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
      console.table(ov.productTotals.map((p) => ({ product: p.product, cost: usd(p.costCents), tokens: tk(p.totalTokens) })));
      console.log("\nHeaviest days (by cost):");
      console.table(ov.heaviestDays.slice(0, 5).map((d) => ({ date: formatDay(d.date), cost: usd(d.costCents) })));

      const top = rankUsers(db.getUserProducts({ from: opts.from, to: opts.to }), loadCsvOptional(opts.csv), {
        by: "cost",
        limit: 5,
      });
      console.log("\nTop 5 users (by cost):");
      console.table(
        top.map((u) => ({ user: u.email, who: attrLabel(u.attributes), cost: usd(u.costCents), tokens: tk(u.totalTokens) })),
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
  .description("List the columns (dimensions) available to group by in the CSV.")
  .option("--csv <path>", "attributes CSV (overrides CSV_PATH)")
  .action((opts: { csv?: string }) => {
    const attributes = loadCsv(opts.csv);
    const dims = dimensionsOf(attributes);
    if (dims.length === 0) {
      console.log("No CSV attributes loaded. Pass --csv <path> or set CSV_PATH in .env.");
      return;
    }
    console.log(`\n${attributes.size} developer row(s). Group by any of:\n`);
    for (const d of dims) console.log(`  - ${d}`);
    console.log(`\ne.g. npm run cli -- group --group-by ${dims[0]}`);
  });

program
  .command("group")
  .description("Aggregate usage/cost/activity by any CSV column (run 'columns' to list them).")
  .requiredOption("--group-by <dimension>", "any column in your CSV (e.g. Level, BU, Role)")
  .option("--from <date>")
  .option("--to <date>")
  .option("--product <product>", "restrict cost/tokens to one product")
  .option("--csv <path>", "attributes CSV (overrides CSV_PATH)")
  .action((opts: { groupBy: string; from?: string; to?: string; product?: string; csv?: string }) => {
    const db = openDb();
    try {
      const attributes = loadCsv(opts.csv);
      const dimension = resolveDim(attributes, opts.groupBy);
      const groups = aggregateByDimension(
        db.getUserProducts({ from: opts.from, to: opts.to }),
        db.getUserDays({ from: opts.from, to: opts.to }),
        attributes,
        dimension,
        opts.product,
      );
      console.log(`\nUsage by ${dimension}${opts.product ? ` (product: ${opts.product})` : ""}:\n`);
      console.table(
        groups.map((g) => ({
          [dimension]: g.key,
          devs: g.developers,
          "active days": g.activeUserDays,
          cost: usd(g.costCents),
          "$/dev": usd(g.avgCostPerDeveloper),
          tokens: tk(g.totalTokens),
          "tok/dev": tk(Math.round(g.avgTokensPerDeveloper)),
          "cc sess": g.ccSessions,
          "sess/dev": g.developers ? (g.ccSessions / g.developers).toFixed(1) : "0",
          "chat msgs": g.chatMessages,
          "web srch": g.webSearches,
        })),
      );
    } finally {
      db.close();
    }
  });

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
  .requiredOption("--group-by <dimension>", "any column in your CSV (e.g. Level, BU, Role)")
  .requiredOption("--out <file>")
  .option("--from <date>")
  .option("--to <date>")
  .option("--product <product>")
  .option("--csv <path>")
  .action((opts: { groupBy: string; out: string; from?: string; to?: string; product?: string; csv?: string }) => {
    const db = openDb();
    try {
      const attributes = loadCsv(opts.csv);
      const dimension = resolveDim(attributes, opts.groupBy);
      const groups = aggregateByDimension(
        db.getUserProducts({ from: opts.from, to: opts.to }),
        db.getUserDays({ from: opts.from, to: opts.to }),
        attributes,
        dimension,
        opts.product,
      );
      writeFileSync(opts.out, groupsToCsv(groups, dimension));
      console.log(`Wrote ${groups.length} group(s) to ${opts.out}.`);
    } finally {
      db.close();
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
