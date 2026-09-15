import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, PRODUCTS, tokens, usd, type GroupRow, type GroupsResponse, type TimelineDimension } from "../api.js";
import { COLORS, NEUTRAL_COLOR, xAxisProps } from "../charts.js";
import { bucketSeries, type Granularity } from "../series.js";
import { useUrlParam } from "../url.js";
import { SortableTable, type Column } from "./SortableTable.js";

/** Chart/table ordering: by metric magnitude ("size", default) or by group name ("alpha"). */
type SortOrder = "size" | "alpha";

interface Props {
  from: string;
  to: string;
  dimensions: string[];
  timelineDimensions: TimelineDimension[];
  filterQuery?: string;
  onError: (msg: string | null) => void;
}

type Metric = { key: keyof GroupRow; label: string; money?: boolean };
const METRICS: Metric[] = [
  { key: "costCents", label: "Total cost", money: true },
  { key: "avgCostPerDeveloper", label: "Avg cost / developer", money: true },
  { key: "totalTokens", label: "Total tokens" },
  { key: "ccSessions", label: "Claude Code sessions" },
  { key: "chatMessages", label: "Chat messages" },
  { key: "activeUserDays", label: "Active user-days" },
];

const columns: Column<GroupRow>[] = [
  { key: "key", label: "Group", value: (r) => r.key },
  { key: "developers", label: "Devs", numeric: true, value: (r) => r.developers },
  { key: "activeUserDays", label: "Active days", numeric: true, value: (r) => r.activeUserDays, render: (r) => r.activeUserDays.toFixed(1) },
  { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
  { key: "avgCostPerDeveloper", label: "$/dev", numeric: true, value: (r) => r.avgCostPerDeveloper, render: (r) => usd(r.avgCostPerDeveloper) },
  { key: "totalTokens", label: "Tokens", numeric: true, value: (r) => r.totalTokens, render: (r) => tokens(r.totalTokens) },
  { key: "chatMessages", label: "Chat", numeric: true, value: (r) => r.chatMessages },
  { key: "ccSessions", label: "CC sessions", numeric: true, value: (r) => r.ccSessions },
  { key: "ccLocAdded", label: "CC loc+", numeric: true, value: (r) => r.ccLocAdded },
  { key: "coworkMessages", label: "Cowork", numeric: true, value: (r) => r.coworkMessages },
  { key: "webSearches", label: "Web", numeric: true, value: (r) => r.webSearches },
];

// Must match core's UNASSIGNED_KEY (packages/core/src/projects.ts) — the bucket for
// days with no active project/team/client membership.
const UNASSIGNED_KEY = "Unassigned";
const OTHER_KEY = "Other";
const MAX_STACK_KEYS = 8;
const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/** Pivot the daily group×date rows into one row per bucket with a cost column per
 *  key, capping the stack at the top MAX_STACK_KEYS keys (by total cost) plus an
 *  "Other" catch-all. Unassigned always renders, last, regardless of rank. */
function useStackedSeries(data: GroupsResponse | null, granularity: Granularity) {
  return useMemo(() => {
    if (!data || data.timeseries.length === 0) return { rows: [] as Record<string, number | string>[], keys: [] as string[] };

    const rankedKeys = data.keys.filter((k) => k !== UNASSIGNED_KEY);
    const hasUnassigned = data.keys.includes(UNASSIGNED_KEY);
    const top = new Set(rankedKeys.slice(0, MAX_STACK_KEYS));
    const hasOther = rankedKeys.length > top.size;

    const byDate = new Map<string, Record<string, number | string>>();
    for (const row of data.timeseries) {
      let bucket = byDate.get(row.date);
      if (!bucket) byDate.set(row.date, (bucket = { date: row.date }));
      const label = row.key === UNASSIGNED_KEY || top.has(row.key) ? row.key : OTHER_KEY;
      bucket[label] = (Number(bucket[label]) || 0) + row.costCents / 100;
    }
    const daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const bucketed = bucketSeries(daily, granularity, {});

    const keys = [...rankedKeys.filter((k) => top.has(k)), ...(hasOther ? [OTHER_KEY] : []), ...(hasUnassigned ? [UNASSIGNED_KEY] : [])];
    return { rows: bucketed, keys };
  }, [data, granularity]);
}

export function GroupsView({ from, to, dimensions, timelineDimensions, filterQuery, onError }: Props) {
  const [dimension, setDimension] = useUrlParam("groupBy", "");
  const [product, setProduct] = useUrlParam("product", "");
  const [metricKey, setMetricKey] = useUrlParam("metric", String(METRICS[0]!.key));
  const [sortOrderRaw, setSortOrder] = useUrlParam("sort", "size");
  const [granularityRaw, setGranularity] = useUrlParam("granularity", "week");
  const [data, setData] = useState<GroupsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const metric = METRICS.find((m) => String(m.key) === metricKey) ?? METRICS[0]!;
  const sortOrder: SortOrder = sortOrderRaw === "alpha" ? "alpha" : "size";
  const granularity: Granularity = granularityRaw === "day" || granularityRaw === "month" ? granularityRaw : "week";

  // Default Group By once dimensions load (unless a URL/previous pick is still valid):
  // prefer the first timeline facet (Project) when a projects file is loaded, else the
  // first CSV column.
  useEffect(() => {
    const timelineIds = timelineDimensions.map((d) => d.id);
    if (timelineIds.includes(dimension) || dimensions.includes(dimension)) return;
    if (timelineIds.length) setDimension(timelineIds[0]!, true);
    else if (dimensions.length) setDimension(dimensions[0]!, true);
  }, [dimensions, timelineDimensions, dimension, setDimension]);

  const load = useCallback(async () => {
    if (!dimension) return;
    setLoading(true);
    onError(null);
    try {
      setData(await api.groups(dimension, from || undefined, to || undefined, product || undefined, filterQuery));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dimension, product, from, to, filterQuery, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Order groups for the chart (and the table's default) by the selected metric or by name.
  const orderedGroups = useMemo(() => {
    const groups = [...(data?.groups ?? [])];
    if (sortOrder === "alpha") {
      groups.sort((a, b) => a.key.localeCompare(b.key));
    } else {
      groups.sort((a, b) => Number(b[metric.key]) - Number(a[metric.key]));
    }
    return groups;
  }, [data, sortOrder, metric.key]);

  const chartData = orderedGroups.map((g) => ({ name: g.key, value: Number(g[metric.key]) }));
  const stacked = useStackedSeries(data, granularity);
  const stackColor = useMemo(() => {
    const colorByKey = new Map<string, string>();
    let i = 0;
    for (const key of stacked.keys) {
      if (key === UNASSIGNED_KEY) colorByKey.set(key, NEUTRAL_COLOR);
      else if (key === OTHER_KEY) colorByKey.set(key, "#3a3f4d");
      else colorByKey.set(key, COLORS[i++ % COLORS.length]!);
    }
    return colorByKey;
  }, [stacked.keys]);

  const isTimelineDimension = dimension.startsWith("@");

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <label>Group by</label>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {dimensions.length === 0 && timelineDimensions.length === 0 && (
              <option value="">— no CSV or projects file loaded —</option>
            )}
            {timelineDimensions.length > 0 && (
              <optgroup label="Timeline">
                {timelineDimensions.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </optgroup>
            )}
            {dimensions.length > 0 && (
              <optgroup label="CSV columns">
                {dimensions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label>Product (cost/tokens)</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Chart metric</label>
          <select value={String(metric.key)} onChange={(e) => setMetricKey(e.target.value)}>
            {METRICS.map((m) => (
              <option key={String(m.key)} value={String(m.key)}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Sort order</label>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="size">Size (metric)</option>
            <option value="alpha">Name (A–Z)</option>
          </select>
        </div>
        <a href={api.exportUrl(dimension, from || undefined, to || undefined, product || undefined, filterQuery)}>
          <button className="secondary" type="button">Export CSV</button>
        </a>
        <a href={api.exportGroupsDailyUrl(dimension, from || undefined, to || undefined, product || undefined, filterQuery)}>
          <button className="secondary" type="button">Export daily CSV</button>
        </a>
      </div>

      {loading && <p className="muted">Loading…</p>}

      {data && stacked.rows.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Cost over time</h3>
            <div className="segmented" role="group" aria-label="Granularity">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={granularity === g.key ? "active" : ""}
                  onClick={() => setGranularity(g.key)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stacked.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                <XAxis
                  dataKey="date"
                  stroke="#9aa3b2"
                  fontSize={11}
                  {...xAxisProps(stacked.rows.length, 10, { rotateWhenShort: true })}
                />
                <YAxis stroke="#9aa3b2" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
                  formatter={(v: number) => usd(v * 100)}
                />
                <Legend />
                {stacked.keys.map((key) => (
                  <Bar key={key} dataKey={key} stackId="groups" fill={stackColor.get(key)} name={key} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {data && data.groups.length > 0 && (
        <>
          <div style={{ height: 280, marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                <XAxis
                  dataKey="name"
                  stroke="#9aa3b2"
                  fontSize={12}
                  {...xAxisProps(chartData.length, Math.max(0, ...chartData.map((d) => d.name.length)))}
                />
                <YAxis stroke="#9aa3b2" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
                  formatter={(v: number) => (metric.money ? usd(v) : metric.key === "totalTokens" ? tokens(v) : v)}
                />
                <Bar dataKey="value" fill="#d97757" name={metric.label} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SortableTable
            columns={columns}
            rows={orderedGroups}
            initialSort={sortOrder === "alpha" ? "key" : String(metric.key)}
            initialDesc={sortOrder !== "alpha"}
          />
        </>
      )}

      {data && data.groups.length === 0 && !loading && (
        <p className="muted">No cached data for this range. Sync first.</p>
      )}

      {data && !isTimelineDimension && data.unmatchedCount > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {data.unmatchedCount} developer(s) in analytics have no CSV match (grouped as “(unmatched)”). Upload a CSV
          whose <code>email</code> column matches your org's emails to break these out.
        </p>
      )}
    </div>
  );
}
