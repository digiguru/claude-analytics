import { buildOverview, rankUsers } from "@claude-analytics/core";
import { attrLabel, formatDay, formatTable, tk, usd } from "../format.js";
import type { CliDeps, CommandResult } from "./types.js";

export interface OverviewOpts {
  from?: string;
  to?: string;
}

export function runOverview(deps: CliDeps, opts: OverviewOpts): CommandResult {
  const lines = [...deps.warnings];
  const ov = buildOverview(deps.db.getSummaries(opts.from, opts.to), deps.db.getOrgProducts(opts.from, opts.to));
  if (ov.timeseries.length === 0) {
    lines.push('No cached data. Run "sync" for the date range first.');
    return { code: 0, lines };
  }
  lines.push(
    "",
    `Total cost: ${usd(ov.totalCostCents)} · total tokens: ${tk(ov.totalTokens)}`,
    "",
    "Cost by product:",
    ...formatTable(
      ov.productTotals.map((p) => ({ product: p.product, cost: usd(p.costCents), tokens: tk(p.totalTokens) })),
    ),
    "",
    "Heaviest days (by cost):",
    ...formatTable(ov.heaviestDays.slice(0, 5).map((d) => ({ date: formatDay(d.date), cost: usd(d.costCents) }))),
  );

  const top = rankUsers(deps.db.getUserProducts({ from: opts.from, to: opts.to }), deps.attributes, {
    by: "cost",
    limit: 5,
  });
  lines.push(
    "",
    "Top 5 users (by cost):",
    ...formatTable(
      top.map((u) => ({
        user: u.email,
        who: attrLabel(u.attributes),
        cost: usd(u.costCents),
        tokens: tk(u.totalTokens),
      })),
    ),
  );
  return { code: 0, lines };
}
