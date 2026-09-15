import { rankUsers } from "@claude-analytics/core";
import { attrLabel, formatTable, tk, usd } from "../format.js";
import type { CliDeps, CommandResult } from "./types.js";

export interface TopOpts {
  by?: string;
  limit?: string;
  from?: string;
  to?: string;
}

export function runTop(deps: CliDeps, opts: TopOpts): CommandResult {
  const lines = [...deps.warnings];
  // #30: an unrecognised --by used to silently rank by cost; now it's an
  // error. `undefined` (the option wasn't passed) still defaults to cost.
  if (opts.by !== undefined && opts.by !== "cost" && opts.by !== "tokens") {
    return { code: 1, lines: [...lines, `Invalid --by "${opts.by}". Expected "cost" or "tokens".`] };
  }
  const by = opts.by ?? "cost";
  const limit = Math.max(1, Number.parseInt(opts.limit ?? "10", 10) || 10);
  const ranked = rankUsers(deps.db.getUserProducts({ from: opts.from, to: opts.to }), deps.attributes, {
    by,
    limit,
  });
  if (ranked.length === 0) {
    lines.push('No cached data. Run "sync" first.');
    return { code: 0, lines };
  }
  lines.push(
    "",
    `Top ${ranked.length} users by ${by}:`,
    "",
    ...formatTable(
      ranked.map((u, i) => ({
        "#": i + 1,
        user: u.email,
        who: attrLabel(u.attributes),
        cost: usd(u.costCents),
        tokens: tk(u.totalTokens),
        requests: u.requests,
      })),
    ),
  );
  return { code: 0, lines };
}
