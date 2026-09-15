import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, tokens, usd, type Attributes, type MemberDay, type MemberSummary, type ProjectCycles, type UserListEntry } from "../api.js";
import { CHART_MARGIN, RechartsReferenceArea as ReferenceArea, Y_AXIS_WIDTH, wrapLabel, xAxisProps } from "../charts.js";
import { snapBand } from "../cycles.js";
import { prepareSeries, type Granularity } from "../series.js";
import { CycleRail } from "./CycleRail.js";
import { SeriesControls } from "./SeriesControls.js";
import { useUrlParam } from "../url.js";
import { filterToQuery, userPasses, type FilterSpec } from "../filters.js";

/** A short label from whatever attributes a CSV happens to carry. */
function attrLabel(a: Attributes | null): string {
  if (!a) return "no CSV match";
  const vals = Object.values(a).filter((v) => v && v.trim());
  return vals.length ? vals.slice(0, 3).join(" · ") : "no attributes";
}

/** accepted / (accepted + rejected), or "–" when there were no tool edits. */
function acceptanceRate(accepted: number, rejected: number): string {
  const total = accepted + rejected;
  return total > 0 ? `${Math.round((accepted / total) * 100)}%` : "–";
}

/** cache reads / (cache reads + uncached input), or "–" when there was no input. */
function cacheReadRatio(cacheRead: number, input: number): string {
  const total = cacheRead + input;
  return total > 0 ? `${Math.round((cacheRead / total) * 100)}%` : "–";
}

interface Props {
  from: string;
  to: string;
  filter: FilterSpec;
  projectCycles: ProjectCycles[];
  onError: (msg: string | null) => void;
}

export function MembersView({ from, to, filter, projectCycles, onError }: Props) {
  const [users, setUsers] = useState<UserListEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRaw, setSelected] = useUrlParam("member", "");
  const selected = selectedRaw || null;
  const [detail, setDetail] = useState<MemberSummary | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [showTrend, setShowTrend] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => onError(e instanceof Error ? e.message : String(e)));
  }, [onError]);

  const loadDetail = useCallback((email: string) => setSelected(email), [setSelected]);

  // Fetch whenever the selected member (incl. deep-link / back-forward) or date range changes.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    onError(null);
    api
      .member(selected, from || undefined, to || undefined)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && onError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [selected, from, to, onError]);

  const filtered = useMemo(
    () => users.filter((u) => u.email.includes(search.toLowerCase()) && userPasses(filter, u)),
    [users, search, filter],
  );
  const series = (detail?.daily ?? []).map((d) => ({ date: d.date, cost: d.costCents / 100, chat: d.chatMessages, cc: d.ccSessions }));
  const { data: chartData } = prepareSeries(series, {
    granularity,
    showTrend,
    showForecast,
    trendKey: "cost",
    aggs: { cost: "sum", chat: "sum", cc: "sum" },
  });
  // This person's project(s) in range, with cycle definitions — bands when they
  // were on exactly one, else a lane per project (mirrors the Groups page).
  const memberProjectCycles = projectCycles.filter((p) => detail?.projects.includes(p.project));
  const singleProjectCycles = memberProjectCycles.length === 1 ? memberProjectCycles[0]!.cycles : [];
  const chartLabels = chartData.map((r) => String(r.date));

  return (
    <div className="panel">
      <div className="grid-2">
        <div>
          <input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <a
            href={api.exportMembersUrl(from || undefined, to || undefined, filterToQuery(filter))}
            style={{ display: "block", marginBottom: 8 }}
          >
            <button className="secondary" type="button" style={{ width: "100%" }}>
              Export CSV (daily cost per member)
            </button>
          </a>
          <a
            href={api.exportMembersLongUrl(from || undefined, to || undefined, filterToQuery(filter))}
            style={{ display: "block", marginBottom: 8 }}
          >
            <button className="secondary" type="button" style={{ width: "100%" }}>
              Export CSV (every day)
            </button>
          </a>
          <div className="dev-list">
            {filtered.map((u) => (
              <button key={u.email} className={selected === u.email ? "active" : ""} onClick={() => loadDetail(u.email)}>
                {u.email}
                <br />
                <span className="muted">{attrLabel(u.attributes)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="muted">No members match.</p>}
          </div>
        </div>

        <div>
          {!detail && <p className="muted">Select a member to see their cross-product usage.</p>}
          {detail && (
            <>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{detail.email}</h2>
              {detail.attributes && Object.keys(detail.attributes).length > 0 && (
                <p className="muted" style={{ marginTop: -8 }}>
                  {Object.entries(detail.attributes)
                    .filter(([, v]) => v && v.trim())
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              )}

              <div className="stat-grid">
                <Stat label="Cost" value={usd(detail.totalCostCents)} />
                <Stat label="Tokens" value={tokens(detail.totalTokens)} />
                <Stat label="Active days" value={String(detail.activeDays)} />
                <Stat
                  label="Accept rate"
                  value={acceptanceRate(detail.ccToolAccepted, detail.ccToolRejected)}
                  sub={`${detail.ccToolAccepted}/${detail.ccToolAccepted + detail.ccToolRejected} edits`}
                />
                <Stat label="Cache-read" value={cacheReadRatio(detail.cacheReadTokens, detail.inputTokens)} sub="of input" />
                <Stat label="Chat msgs" value={String(detail.chatMessages)} />
                <Stat label="CC sessions" value={String(detail.ccSessions)} />
                <Stat label="Design msgs" value={String(detail.designMessages)} />
                <Stat label="Office msgs" value={String(detail.officeMessages)} />
                <Stat label="Web searches" value={String(detail.webSearches)} />
              </div>

              <h3>Cost by product</h3>
              <p className="muted" style={{ marginTop: -6 }}>
                {Object.entries(detail.costByProduct).map(([p, c]) => (
                  <span className="pill" key={p}>{p}: {usd(c)}</span>
                ))}
                {Object.keys(detail.costByProduct).length === 0 && "no cost in range"}
              </p>

              {series.length > 0 && (
                <>
                  <div className="chart-head">
                    <SeriesControls
                      granularity={granularity}
                      onGranularity={setGranularity}
                      showTrend={showTrend}
                      onTrend={setShowTrend}
                      showForecast={showForecast}
                      onForecast={setShowForecast}
                    />
                  </div>
                  <div style={{ height: 260, margin: "12px 0" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                        {singleProjectCycles.map((c, i) => {
                          const span = snapBand(c, chartLabels, granularity);
                          if (!span) return null;
                          const wide = chartLabels.indexOf(span.x2) - chartLabels.indexOf(span.x1) >= 1;
                          return (
                            <ReferenceArea
                              key={c.name}
                              yAxisId="l"
                              x1={span.x1}
                              x2={span.x2}
                              zIndex={0}
                              fill="#ffffff"
                              fillOpacity={i % 2 ? 0.07 : 0.04}
                              stroke="#2a2f3a"
                              strokeDasharray="3 3"
                              label={wide ? { value: wrapLabel(c.name, 18, 1)[0], position: "insideTopLeft", fill: "#9aa3b2", fontSize: 11 } : undefined}
                            />
                          );
                        })}
                        <XAxis dataKey="date" stroke="#9aa3b2" fontSize={11} {...xAxisProps(chartData.length, 10, { rotateWhenShort: true })} />
                        <YAxis yAxisId="l" stroke="#d97757" fontSize={11} width={Y_AXIS_WIDTH} />
                        <YAxis yAxisId="r" orientation="right" stroke="#5a6b8c" fontSize={11} width={Y_AXIS_WIDTH} />
                        <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }} formatter={(v, n) => (typeof n === "string" && n.startsWith("cost") ? `$${Number(v ?? 0).toFixed(2)}` : Number(v ?? 0))} />
                        <Legend />
                        <Bar yAxisId="l" dataKey="cost" name="cost ($)" fill="#d97757" />
                        {showForecast && <Bar yAxisId="l" dataKey="costForecast" name="cost (forecast)" fill="#d97757" fillOpacity={0.35} />}
                        {showTrend && <Line yAxisId="l" dataKey="trend" name="cost trend" stroke="#c0a96b" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />}
                        <Line yAxisId="r" dataKey="chat" name="chat msgs" stroke="#7fae7f" strokeWidth={2} dot={false} connectNulls />
                        <Line yAxisId="r" dataKey="cc" name="cc sessions" stroke="#b08cc0" strokeWidth={2} dot={false} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {memberProjectCycles.length > 1 && (
                    <CycleRail labels={chartLabels} projects={memberProjectCycles} granularity={granularity} dualAxis />
                  )}
                </>
              )}

              {detail.daily.length > 0 ? (
                <DailyTable rows={detail.daily} />
              ) : (
                <p className="muted">No cached days for this member in range.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type SortKey = keyof MemberDay | "acceptRate" | "cacheRatio";

const DAILY_HEADERS: { key: SortKey; label: string; numeric: boolean; value: (d: MemberDay) => number | string; render: (d: MemberDay) => string }[] = [
  { key: "date", label: "Date", numeric: false, value: (d) => d.date, render: (d) => d.date },
  { key: "costCents", label: "Cost", numeric: true, value: (d) => d.costCents, render: (d) => usd(d.costCents) },
  { key: "totalTokens", label: "Tokens", numeric: true, value: (d) => d.totalTokens, render: (d) => tokens(d.totalTokens) },
  { key: "chatMessages", label: "Chat", numeric: true, value: (d) => d.chatMessages, render: (d) => String(d.chatMessages) },
  { key: "ccSessions", label: "CC", numeric: true, value: (d) => d.ccSessions, render: (d) => String(d.ccSessions) },
  { key: "ccLocAdded", label: "loc+", numeric: true, value: (d) => d.ccLocAdded, render: (d) => String(d.ccLocAdded) },
  {
    key: "acceptRate",
    label: "Accept",
    numeric: true,
    value: (d) => (d.ccToolAccepted + d.ccToolRejected > 0 ? d.ccToolAccepted / (d.ccToolAccepted + d.ccToolRejected) : -1),
    render: (d) => acceptanceRate(d.ccToolAccepted, d.ccToolRejected),
  },
  {
    key: "cacheRatio",
    label: "Cache",
    numeric: true,
    value: (d) => (d.cacheReadTokens + d.inputTokens > 0 ? d.cacheReadTokens / (d.cacheReadTokens + d.inputTokens) : -1),
    render: (d) => cacheReadRatio(d.cacheReadTokens, d.inputTokens),
  },
  { key: "coworkMessages", label: "Cowork", numeric: true, value: (d) => d.coworkMessages, render: (d) => String(d.coworkMessages) },
  { key: "designMessages", label: "Design", numeric: true, value: (d) => d.designMessages, render: (d) => String(d.designMessages) },
  { key: "officeMessages", label: "Office", numeric: true, value: (d) => d.officeMessages, render: (d) => String(d.officeMessages) },
  { key: "webSearches", label: "Web", numeric: true, value: (d) => d.webSearches, render: (d) => String(d.webSearches) },
];

/** Daily table with sortable headers and click-to-expand per-product cost. */
function DailyTable({ rows }: { rows: MemberDay[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [desc, setDesc] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const col = DAILY_HEADERS.find((c) => c.key === sortKey)!;
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (typeof av === "number" && typeof bv === "number") return desc ? bv - av : av - bv;
      return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
  }, [rows, col, desc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 18 }} />
          {DAILY_HEADERS.map((c) => (
            <th key={c.key} className={c.numeric ? "num" : ""} onClick={() => toggleSort(c.key)}>
              {c.label}
              {sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((d) => {
          const products = Object.entries(d.costByProduct).sort((a, b) => b[1] - a[1]);
          const isOpen = expanded === d.date;
          return [
            <tr
              key={d.date}
              className="day-row"
              onClick={() => setExpanded((e) => (e === d.date ? null : d.date))}
              title="Show cost by product"
            >
              <td className="muted">{products.length ? (isOpen ? "▾" : "▸") : ""}</td>
              {DAILY_HEADERS.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : ""}>
                  {c.render(d)}
                </td>
              ))}
            </tr>,
            isOpen && (
              <tr key={`${d.date}-detail`} className="day-detail">
                <td />
                <td colSpan={DAILY_HEADERS.length}>
                  <span className="muted">Cost by product: </span>
                  {products.length ? (
                    products.map(([p, c]) => (
                      <span className="pill" key={p}>
                        {p}: {usd(c)}
                      </span>
                    ))
                  ) : (
                    <span className="muted">no cost this day</span>
                  )}
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <p className="label muted">{label}{sub ? ` · ${sub}` : ""}</p>
    </div>
  );
}
