import { attributesFor, summarizeMember } from "@claude-analytics/core";
import { attrLabel, formatTable, tk, usd } from "../format.js";
import type { CliDeps, CommandResult } from "./types.js";

export interface MemberOpts {
  email: string;
  from?: string;
  to?: string;
}

export function runMember(deps: CliDeps, opts: MemberOpts): CommandResult {
  const lines = [...deps.warnings];
  const attrs = attributesFor(deps.attributes, opts.email);
  const m = summarizeMember(
    deps.db.getUserProducts({ from: opts.from, to: opts.to, email: opts.email }),
    deps.db.getUserDays({ from: opts.from, to: opts.to, email: opts.email }),
    opts.email,
    attrs,
  );
  if (m.daily.length === 0) {
    lines.push(`No cached metrics for ${opts.email}. Run "sync" first.`);
    return { code: 0, lines };
  }
  lines.push(
    "",
    `${m.email}${attrs ? ` — ${attrLabel(attrs)}` : ""}`,
    `Active days: ${m.activeDays} · cost: ${usd(m.totalCostCents)} · tokens: ${tk(m.totalTokens)} · ` +
      `chat: ${m.chatMessages} · cc sessions: ${m.ccSessions} · cc loc+: ${m.ccLocAdded} · web: ${m.webSearches}`,
    "",
    "Cost by product:",
    ...formatTable(Object.entries(m.costByProduct).map(([product, cents]) => ({ product, cost: usd(cents) }))),
  );
  return { code: 0, lines };
}
