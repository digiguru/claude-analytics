#!/usr/bin/env node
import { Command } from "commander";
import { createClient, MetricsDb } from "@claude-analytics/core";
import { loadConfig } from "./config.js";
import { loadCsvOptional, loadProjectsOptional } from "./load.js";
import { runColumns } from "./commands/columns.js";
import { runExport } from "./commands/export.js";
import { runGroup } from "./commands/group.js";
import { runMember } from "./commands/member.js";
import { runOverview } from "./commands/overview.js";
import { runProjects } from "./commands/projects.js";
import { runSync } from "./commands/sync.js";
import { runTop } from "./commands/top.js";
import type { CliDeps, CommandResult } from "./commands/types.js";

// Every command function below is pure with respect to process/console (see
// apps/cli/src/commands/*.ts) — this file's only job is: open the DB, load
// CSV/projects, call the command, print its lines, exit with its code (#37).

const program = new Command();
program
  .name("claude-analytics")
  .description("Query the Claude Enterprise Analytics API and join it to a developer CSV.")
  .version("0.2.0");

function openDb(): MetricsDb {
  return new MetricsDb(loadConfig().dbPath);
}

/** Build the CliDeps most commands share: an open DB, plus best-effort CSV/
 *  projects loads (never fatal — see load.ts), with any load failures
 *  collected as warnings for the command to surface in its own output. */
function buildDeps(db: MetricsDb, opts: { csv?: string; projects?: string }): CliDeps {
  const csv = loadCsvOptional(opts.csv ?? loadConfig().csvPath);
  const projects = loadProjectsOptional(opts.projects ?? loadConfig().projectsPath);
  return {
    db,
    attributes: csv.attributes,
    memberships: projects.memberships,
    warnings: [csv.warning, projects.warning].filter((w): w is string => w !== null),
  };
}

function finish(result: CommandResult): never {
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}

program
  .command("sync")
  .description("Fetch all analytics (summaries, activity, cost, usage) for a date range.")
  .requiredOption("--from <date>", "start day (YYYY-MM-DD, UTC, inclusive)")
  .requiredOption("--to <date>", "end day (YYYY-MM-DD, UTC, inclusive)")
  .action(async (opts: { from: string; to: string }) => {
    const db = openDb();
    try {
      const client = createClient(loadConfig().apiKey);
      finish(await runSync({ client, db }, opts));
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
      finish(runOverview(buildDeps(db, opts), opts));
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
    const db = openDb();
    try {
      finish(runTop(buildDeps(db, opts), opts));
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
    const db = openDb();
    try {
      finish(runColumns(buildDeps(db, opts)));
    } finally {
      db.close();
    }
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
        finish(runGroup(buildDeps(db, opts), opts));
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
      finish(runMember(buildDeps(db, opts), { email, ...opts }));
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
        finish(runExport(buildDeps(db, opts), opts));
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
    finish(runProjects({}, { path: opts.projects ?? loadConfig().projectsPath, project: opts.project }));
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
