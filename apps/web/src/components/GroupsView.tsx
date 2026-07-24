import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, PRODUCTS, tokens, usd, type GroupRow, type GroupsResponse } from "../api.js";
import { xAxisProps } from "../charts.js";
import { useUrlParam } from "../url.js";
import { SortableTable, type Column } from "./SortableTable.js";

/** Chart/table ordering: by metric magnitude ("size", default) or by group name ("alpha"). */
type SortOrder = "size" | "alpha";

interface Props {
  from: string;
  to: string;
  dimensions: string[];
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
  { key: "activeUserDays", label: "Active days", numeric: true, value: (r) => r.activeUserDays },
  { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
  { key: "avgCostPerDeveloper", label: "$/dev", numeric: true, value: (r) => r.avgCostPerDeveloper, render: (r) => usd(r.avgCostPerDeveloper) },
  { key: "totalTokens", label: "Tokens", numeric: true, value: (r) => r.totalTokens, render: (r) => tokens(r.totalTokens) },
  { key: "chatMessages", label: "Chat", numeric: true, value: (r) => r.chatMessages },
  { key: "ccSessions", label: "CC sessions", numeric: true, value: (r) => r.ccSessions },
  { key: "ccLocAdded", label: "CC loc+", numeric: true, value: (r) => r.ccLocAdded },
  { key: "coworkMessages", label: "Cowork", numeric: true, value: (r) => r.coworkMessages },
  { key: "webSearches", label: "Web", numeric: true, value: (r) => r.webSearches },
];

export function GroupsView({ from, to, dimensions, filterQuery, onError }: Props) {
  const [dimension, setDimension] = useUrlParam("groupBy", "");
  const [product, setProduct] = useUrlParam("product", "");
  const [metricKey, setMetricKey] = useUrlParam("metric", String(METRICS[0]!.key));
  const [sortOrderRaw, setSortOrder] = useUrlParam("sort", "size");
  const [data, setData] = useState<GroupsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const metric = METRICS.find((m) => String(m.key) === metricKey) ?? METRICS[0]!;
  const sortOrder: SortOrder = sortOrderRaw === "alpha" ? "alpha" : "size";

  // Default to the first available CSV column once dimensions load (unless a URL pinned one).
  useEffect(() => {
    if (dimensions.length && !dimensions.includes(dimension)) setDimension(dimensions[0]!, true);
  }, [dimensions, dimension, setDimension]);

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

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <label>Group by</label>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {dimensions.length === 0 && <option value="">— no CSV loaded —</option>}
            {dimensions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
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
      </div>

      {loading && <p className="muted">Loading…</p>}

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

      {data && data.unmatchedCount > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {data.unmatchedCount} developer(s) in analytics have no CSV match (grouped as “(unmatched)”). Upload a CSV
          whose <code>email</code> column matches your org's emails to break these out.
        </p>
      )}
    </div>
  );
}
