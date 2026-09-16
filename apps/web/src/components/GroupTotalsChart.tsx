import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tokens, usd, type GroupRow, type GroupRowWithPrimary } from "../api.js";
import { buildStackColors, CHART_MARGIN, xAxisProps } from "../charts.js";
import { buildGroupBreakdown, TOP_KEY, TOTAL_KEY } from "../groupBreakdown.js";
import { StackedCostTooltip } from "./StackedCostTooltip.js";

export type SortOrder = "size" | "alpha" | "date";

export interface Metric {
  key: keyof GroupRow;
  label: string;
  money?: boolean;
  /** True for metrics that are a ratio, not a sum (avg cost per seat/active
   *  user). A breakdown of one of these can't be stacked — the segments are
   *  each their own average and wouldn't add up to the group's — so the chart
   *  renders them side-by-side instead. */
  ratio?: boolean;
}

/** The "{metric} by {dimension}" bar chart plus its breakdown/metric/sort
 *  controls — extracted from GroupsView (#29). Doesn't touch the cost-over-time
 *  chart above it; only the ordered groups (and their secondary breakdown
 *  rows) it's given.
 *
 *  "Breakdown by" is the same state the table below uses for its expandable
 *  drill-down rows — one control drives both. Picking a value colourises each
 *  bar into per-secondary-key segments while the bar's *height* and the chart's
 *  ordering stay governed by the metric/sort controls next to it. */
export function GroupTotalsChart({
  dimensionLabel,
  metric,
  metrics,
  onMetricChange,
  sortOrder,
  onSortOrderChange,
  showDateSort,
  orderedGroups,
  secondary = "",
  onSecondaryChange,
  secondaryOptions = [],
  secondaryLabel = "",
  secondaryRows = [],
  secondaryDimension = null,
}: {
  dimensionLabel: string;
  metric: Metric;
  metrics: Metric[];
  onMetricChange: (key: string) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: string) => void;
  showDateSort: boolean;
  orderedGroups: GroupRow[];
  /** The picked "Breakdown by" dimension id ("" = none). Shared with the table. */
  secondary?: string;
  onSecondaryChange?: (v: string) => void;
  secondaryOptions?: { id: string; label: string }[];
  secondaryLabel?: string;
  /** The server's flat primary×secondary rows, from the same response. */
  secondaryRows?: GroupRowWithPrimary[];
  /** The dimension the server actually resolved `secondary` to (null = none). */
  secondaryDimension?: string | null;
}) {
  const format = (v: unknown) => {
    const n = Number(v ?? 0);
    return metric.money ? usd(n) : metric.key === "totalTokens" ? tokens(n) : n;
  };

  // Only stack once the response for *this* breakdown has landed — until then
  // (and whenever the breakdown yields nothing) fall back to the plain bars,
  // rather than flashing an empty chart.
  const breakdown = useMemo(
    () => (secondaryDimension ? buildGroupBreakdown(orderedGroups, secondaryRows, metric.key) : null),
    [secondaryDimension, orderedGroups, secondaryRows, metric.key],
  );
  const stacking = breakdown !== null && breakdown.keys.length > 0;
  const stackColor = useMemo(() => buildStackColors(breakdown?.keys ?? []), [breakdown?.keys]);

  const chartData = stacking
    ? breakdown.rows
    : orderedGroups.map((g) => ({ name: g.key, [TOTAL_KEY]: Number(g[metric.key]) }));
  const labelLen = Math.max(0, ...chartData.map((d) => String(d.name).length));

  return (
    <>
      <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {metric.label} by {dimensionLabel}
          {stacking && `, split by ${secondaryLabel}`}
        </h3>
        {secondaryOptions.length > 0 && onSecondaryChange && (
          <div>
            <label>Breakdown by</label>
            <select value={secondary} onChange={(e) => onSecondaryChange(e.target.value)}>
              <option value="">None</option>
              {secondaryOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}
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
      {stacking && metric.ratio && (
        <p className="muted" style={{ fontSize: 11, margin: "0 0 6px" }}>
          {metric.label} is an average, not a total, so each {secondaryLabel} is shown side-by-side rather than stacked
          — the segments don't add up to the group's own figure.
        </p>
      )}
      <div style={{ height: stacking ? 320 : 280, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ ...CHART_MARGIN, top: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="name" stroke="#9aa3b2" fontSize={12} {...xAxisProps(chartData.length, labelLen)} />
            <YAxis stroke="#9aa3b2" fontSize={12} tickFormatter={(v: number) => String(format(v))} />
            {stacking ? (
              <Tooltip
                content={<StackedCostTooltip format={format} showTotal={!metric.ratio} hideEmpty />}
                cursor={{ fill: "#ffffff", fillOpacity: 0.04 }}
              />
            ) : (
              <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }} formatter={format} />
            )}
            {stacking && <Legend />}
            {stacking ? (
              breakdown.keys.map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  // A ratio metric's segments are each their own average, so
                  // they're grouped (no shared stackId) rather than summed.
                  stackId={metric.ratio ? undefined : "breakdown"}
                  fill={stackColor.get(key)}
                  name={key}
                >
                  {/* One label per group, above the whole stack. Every series
                      carries the list, but each row's label is emitted only by
                      the series sitting at the top of *that* stack (see
                      TOP_KEY) — anchoring it to the last key would lose it for
                      every group with nothing in that key. A stack of averages
                      has no meaningful total, so grouped bars get no label. */}
                  {!metric.ratio && (
                    <LabelList
                      position="top"
                      fill="#9aa3b2"
                      fontSize={11}
                      valueAccessor={(entry: { payload?: Record<string, unknown> }) => {
                        const row = entry?.payload;
                        return row?.[TOP_KEY] === key ? format(row[TOTAL_KEY]) : undefined;
                      }}
                    />
                  )}
                </Bar>
              ))
            ) : (
              <Bar dataKey={TOTAL_KEY} fill="#d97757" name={metric.label}>
                <LabelList dataKey={TOTAL_KEY} position="top" fill="#9aa3b2" fontSize={11} formatter={format} />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
