import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, tokens, usd, type Overview } from "../api.js";
import { xAxisProps } from "../charts.js";
import { bucketLabel, prepareSeries, type Granularity } from "../series.js";
import { SeriesControls } from "./SeriesControls.js";
import { SortableTable, type Column } from "./SortableTable.js";

interface Props {
  from: string;
  to: string;
  filterQuery?: string;
  onError: (msg: string | null) => void;
}

const COLORS = ["#d97757", "#5a6b8c", "#7fae7f", "#b08cc0", "#c0a96b", "#6b9bc0"];

const productColumns: Column<Overview["productTotals"][number]>[] = [
  { key: "product", label: "Product", value: (r) => r.product },
  { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
  { key: "totalTokens", label: "Tokens", numeric: true, value: (r) => r.totalTokens, render: (r) => tokens(r.totalTokens) },
  { key: "requests", label: "Requests", numeric: true, value: (r) => r.requests },
];

export function OverviewView({ from, to, filterQuery, onError }: Props) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [showTrend, setShowTrend] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setOv(await api.overview(from || undefined, to || undefined, filterQuery));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, filterQuery, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="panel"><p className="muted">Loading…</p></div>;
  if (!ov || ov.timeseries.length === 0)
    return <div className="panel"><p className="muted">No cached data. Sync a date range first.</p></div>;

  const heaviest = ov.heaviestDays[0];
  const costSeries = ov.timeseries.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
    dau: d.dailyActiveUsers,
  }));
  const { data: chartData } = prepareSeries(costSeries, {
    granularity,
    showTrend,
    showForecast,
    trendKey: "cost",
    aggs: { cost: "sum", dau: "avg" },
  });

  // Distinct active users per bucket: union each day's active emails into its
  // week/month bucket, so "active users" for a month is the count of unique people
  // active at any point that month — not an average of daily counts. Available only
  // in the filtered view (the server sends per-day emails there); org-wide views
  // fall back to the aggregated daily-active-users figure.
  const activeByBucket = new Map<string, Set<string>>();
  for (const d of ov.timeseries) {
    if (!d.activeEmails) continue;
    const label = bucketLabel(d.date, granularity);
    let set = activeByBucket.get(label);
    if (!set) activeByBucket.set(label, (set = new Set()));
    for (const email of d.activeEmails) set.add(email);
  }

  // Cost per active user for each bucket = that bucket's total cost / its distinct
  // active users. Derived here (after bucketing) rather than as a per-day rate that
  // gets averaged — averaging daily ratios understates the true period figure.
  // Forecast rows carry no cost, so they keep no active-users/cost-per-user value.
  for (const row of chartData) {
    if (typeof row.cost !== "number") continue;
    const distinct = activeByBucket.get(String(row.date));
    const dau = distinct ? distinct.size : typeof row.dau === "number" ? row.dau : 0;
    row.dau = dau;
    row.cpd = dau > 0 ? row.cost / dau : 0;
  }
  const dauLabel = ov.filtered ? "active users" : "daily active users";

  return (
    <div className="panel">
      {ov.filtered && (
        <p className="muted filter-banner">
          Filtered view: cost, tokens and active users are recomputed from the selected members. Seats &amp; adoption are
          org-wide and not shown here.
        </p>
      )}

      <div className="stat-grid">
        <Stat label="Total cost" value={usd(ov.totalCostCents)} />
        <Stat label="Total tokens" value={tokens(ov.totalTokens)} />
        <Stat label="Peak day" value={heaviest ? usd(heaviest.costCents) : "–"} sub={heaviest?.date} />
        <Stat label={ov.filtered ? "Peak active users" : "Peak DAU"} value={String(Math.max(...ov.timeseries.map((d) => d.dailyActiveUsers)))} />
        {!ov.filtered && <Stat label="Seats" value={String(ov.timeseries[ov.timeseries.length - 1]?.assignedSeats ?? 0)} />}
      </div>

      <div className="chart-head">
        <h3>Cost &amp; active users</h3>
        <SeriesControls
          granularity={granularity}
          onGranularity={setGranularity}
          showTrend={showTrend}
          onTrend={setShowTrend}
          showForecast={showForecast}
          onForecast={setShowForecast}
        />
      </div>
      <div style={{ height: 280, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="date" stroke="#9aa3b2" fontSize={11} {...xAxisProps(chartData.length, 10, { rotateWhenShort: true })} />
            <YAxis yAxisId="l" stroke="#d97757" fontSize={11} />
            <YAxis yAxisId="r" orientation="right" stroke="#5a6b8c" fontSize={11} />
            <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }} formatter={(v: number, n) => (typeof n === "string" && n.startsWith("cost") ? `$${Number(v).toFixed(2)}` : v)} />
            <Legend />
            <Bar yAxisId="l" dataKey="cost" name="cost ($)" fill="#d97757" />
            {showForecast && <Bar yAxisId="l" dataKey="costForecast" name="cost (forecast)" fill="#d97757" fillOpacity={0.35} />}
            {showTrend && <Line yAxisId="l" dataKey="trend" name="cost trend" stroke="#c0a96b" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />}
            <Line yAxisId="r" dataKey="dau" name={dauLabel} stroke="#7fae7f" strokeWidth={2} dot={false} connectNulls />
            <Line yAxisId="l" dataKey="cpd" name="cost/active user ($)" stroke="#6b9bc0" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2">
        <div>
          <h3>Cost by product</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ov.productTotals.map((p) => ({ name: p.product, cost: p.costCents / 100 }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                <XAxis type="number" stroke="#9aa3b2" fontSize={11} />
                <YAxis type="category" dataKey="name" width={100} stroke="#9aa3b2" fontSize={11} />
                <Tooltip contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }} formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Bar dataKey="cost" name="cost ($)">
                  {ov.productTotals.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3>Product totals</h3>
          <SortableTable columns={productColumns} rows={ov.productTotals} initialSort="costCents" />
        </div>
      </div>
    </div>
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
