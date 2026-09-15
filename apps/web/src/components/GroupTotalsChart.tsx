import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tokens, usd, type GroupRow } from "../api.js";
import { CHART_MARGIN, xAxisProps } from "../charts.js";

export type SortOrder = "size" | "alpha" | "date";

export interface Metric {
  key: keyof GroupRow;
  label: string;
  money?: boolean;
}

/** The "{metric} by {dimension}" bar chart plus its metric/sort controls —
 *  extracted from GroupsView (#29). Doesn't touch the table below it or the
 *  cost-over-time chart above; only the ordered groups it's given. */
export function GroupTotalsChart({
  dimensionLabel,
  metric,
  metrics,
  onMetricChange,
  sortOrder,
  onSortOrderChange,
  showDateSort,
  orderedGroups,
}: {
  dimensionLabel: string;
  metric: Metric;
  metrics: Metric[];
  onMetricChange: (key: string) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: string) => void;
  showDateSort: boolean;
  orderedGroups: GroupRow[];
}) {
  const chartData = orderedGroups.map((g) => ({ name: g.key, value: Number(g[metric.key]) }));
  const format = (v: unknown) => {
    const n = Number(v ?? 0);
    return metric.money ? usd(n) : metric.key === "totalTokens" ? tokens(n) : n;
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {metric.label} by {dimensionLabel}
        </h3>
        <div>
          <label>Chart metric</label>
          <select value={String(metric.key)} onChange={(e) => onMetricChange(e.target.value)}>
            {metrics.map((m) => (
              <option key={String(m.key)} value={String(m.key)}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Sort order</label>
          <select value={sortOrder} onChange={(e) => onSortOrderChange(e.target.value)}>
            <option value="size">Size (metric)</option>
            <option value="alpha">Name (A–Z)</option>
            {showDateSort && <option value="date">Date</option>}
          </select>
        </div>
      </div>
      <div style={{ height: 280, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ ...CHART_MARGIN, top: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis
              dataKey="name"
              stroke="#9aa3b2"
              fontSize={12}
              {...xAxisProps(chartData.length, Math.max(0, ...chartData.map((d) => d.name.length)))}
            />
            <YAxis stroke="#9aa3b2" fontSize={12} />
            <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }} formatter={format} />
            <Bar dataKey="value" fill="#d97757" name={metric.label}>
              <LabelList dataKey="value" position="top" fill="#9aa3b2" fontSize={11} formatter={format} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
