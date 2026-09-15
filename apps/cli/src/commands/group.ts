import { aggregateByKeyer } from "@claude-analytics/core";
import { formatTable, tk, usd } from "../format.js";
import { resolveGroupByOrError } from "./groupBy.js";
import type { CliDeps, CommandResult } from "./types.js";

export interface GroupOpts {
  groupBy: string;
  from?: string;
  to?: string;
  product?: string;
}

export function runGroup(deps: CliDeps, opts: GroupOpts): CommandResult {
  const lines = [...deps.warnings];
  const resolved = resolveGroupByOrError(deps.attributes, deps.memberships, opts.groupBy);
  if ("error" in resolved) return { code: 1, lines: [...lines, resolved.error] };
  const { selector } = resolved;

  const groups = aggregateByKeyer(
    deps.db.getUserProducts({ from: opts.from, to: opts.to }),
    deps.db.getUserDays({ from: opts.from, to: opts.to }),
    selector.keyer,
    opts.product,
  );
  lines.push(
    "",
    `Usage by ${selector.id}${opts.product ? ` (product: ${opts.product})` : ""}:`,
    "",
    ...formatTable(
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
    ),
  );
  return { code: 0, lines };
}
