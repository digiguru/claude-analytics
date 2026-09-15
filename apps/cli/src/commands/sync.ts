import { fetchRange, type EnterpriseClient, type MetricsDb } from "@claude-analytics/core";
import type { CommandResult } from "./types.js";

export interface SyncDeps {
  client: EnterpriseClient;
  db: MetricsDb;
}

export interface SyncOpts {
  from: string;
  to: string;
}

export async function runSync(deps: SyncDeps, opts: SyncOpts): Promise<CommandResult> {
  const lines: string[] = [];
  const r = await fetchRange(deps.client, deps.db, opts.from, opts.to, (p) => lines.push(`  [${p.step}] ${p.detail}`));
  if (r.effectiveRange) {
    lines.push(
      "",
      `Synced ${r.effectiveRange.from}..${r.effectiveRange.to}: ` +
        `${r.summaryDays} summary day(s), ${r.activityDays} activity day(s), ` +
        `${r.userProductRows} user×product row(s), ${r.orgProductRows} org×product row(s).`,
    );
  } else {
    lines.push(
      "",
      `Nothing to sync: ${opts.from}..${opts.to} falls entirely before analytics data begins, or within the reporting lag.`,
    );
  }
  if (r.unparseableAmounts > 0) {
    lines.push(
      `  WARNING: ${r.unparseableAmounts} cost amount(s) failed to parse and were recorded as $0. ` +
        `Cost totals for this sync may be understated.`,
    );
  }
  return { code: 0, lines };
}
