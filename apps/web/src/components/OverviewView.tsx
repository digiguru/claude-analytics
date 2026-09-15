import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, tokens, usd, type Overview, type ProjectCycles } from "../api.js";
import { bucketLabel, prepareSeries, type Granularity } from "../series.js";
import { CycleRail } from "./CycleRail.js";
import { SeriesControls } from "./SeriesControls.js";
import { SortableTable, type Column } from "./SortableTable.js";

// Both charts come from the same module, so they share one chunk and one
// fetch — recharts stays off the initial bundle even though Overview is the
// eagerly-imported default tab. See OverviewCharts.tsx.
const CostAndUsersChart = lazy(() => import("./OverviewCharts.js").then((m) => ({ default: m.CostAndUsersChart })));
const CostByProductChart = lazy(() => import("./OverviewCharts.js").then((m) => ({ default: m.CostByProductChart })));

interface Props {
  from: string;
  to: string;
  projectCycles: ProjectCycles[];
  filterQuery?: string;
  onError: (msg: string | null) => void;
}

const productColumns: Column<Overview["productTotals"][number]>[] = [
  { key: "product", label: "Product", value: (r) => r.product },
  { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
  {
    key: "totalTokens",
    label: "Tokens",
    numeric: true,
    value: (r) => r.totalTokens,
    render: (r) => tokens(r.totalTokens),
  },
  { key: "requests", label: "Requests", numeric: true, value: (r) => r.requests },
];

export function OverviewView({ from, to, projectCycles, filterQuery, onError }: Props) {
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
    // The standard fetch-on-mount pattern (see react.dev's own data-fetching
    // example): `load` resets `loading`/error state synchronously before its
    // internal `await`, which this rule flags on any reachable setState call
    // regardless of an async gap. Intentional, not a bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Distinct active users per bucket, and cost-per-active-user derived from
  // it, folded into one memo (not computed by mutating prepareSeries' rows
  // during render — see #23 item 3). Union each day's active emails into its
  // week/month bucket, so "active users" for a month is the count of unique
  // people active at any point that month — not an average of daily counts.
  // Available only in the filtered view (the server sends per-day emails
  // there); org-wide views fall back to the aggregated daily-active-users
  // figure. Cost per active user is derived here (after bucketing) rather
  // than as a per-day rate that gets averaged — averaging daily ratios
  // understates the true period figure. Forecast rows carry no cost, so they
  // keep no active-users/cost-per-user value.
  const chartData = useMemo(() => {
    if (!ov) return [];
    const costSeries = ov.timeseries.map((d) => ({
      date: d.date,
      cost: d.costCents / 100,
      dau: d.dailyActiveUsers,
    }));
    const { data } = prepareSeries(costSeries, {
      granularity,
      showTrend,
      showForecast,
      trendKey: "cost",
      aggs: { cost: "sum", dau: "avg" },
    });

    const activeByBucket = new Map<string, Set<string>>();
    for (const d of ov.timeseries) {
      if (!d.activeEmails) continue;
      const label = bucketLabel(d.date, granularity);
      let set = activeByBucket.get(label);
      if (!set) activeByBucket.set(label, (set = new Set()));
      for (const email of d.activeEmails) set.add(email);
    }

    return data.map((row) => {
      if (typeof row.cost !== "number") return row;
      const distinct = activeByBucket.get(String(row.date));
      const dau = distinct ? distinct.size : typeof row.dau === "number" ? row.dau : 0;
      return { ...row, dau, cpd: dau > 0 ? row.cost / dau : 0 };
    });
  }, [ov, granularity, showTrend, showForecast]);

  if (loading)
    return (
      <div className="panel">
        <p className="muted">Loading…</p>
      </div>
    );
  if (!ov || ov.timeseries.length === 0)
    return (
      <div className="panel">
        <p className="muted">No cached data. Sync a date range first.</p>
      </div>
    );

  const heaviest = ov.heaviestDays[0];
  const dauLabel = ov.filtered ? "active users" : "daily active users";

  return (
    <div className="panel">
      {ov.filtered && (
        <p className="muted filter-banner">
          Filtered view: cost, tokens and active users are recomputed from the selected members. Seats &amp; adoption
          are org-wide and not shown here.
        </p>
      )}

      <div className="stat-grid">
        <Stat label="Total cost" value={usd(ov.totalCostCents)} />
        <Stat label="Total tokens" value={tokens(ov.totalTokens)} />
        <Stat label="Peak day" value={heaviest ? usd(heaviest.costCents) : "–"} sub={heaviest?.date} />
        <Stat
          label={ov.filtered ? "Peak active users" : "Peak DAU"}
          value={String(Math.max(...ov.timeseries.map((d) => d.dailyActiveUsers)))}
        />
        {!ov.filtered && (
          <Stat label="Seats" value={String(ov.timeseries[ov.timeseries.length - 1]?.assignedSeats ?? 0)} />
        )}
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
      {/* The wrapper keeps its fixed height while the chart chunk loads, so
          the rest of the page doesn't shift when it arrives. */}
      <div style={{ height: 280, marginBottom: 20 }}>
        <Suspense fallback={<p className="muted">Loading chart…</p>}>
          <CostAndUsersChart
            chartData={chartData}
            dauLabel={dauLabel}
            showTrend={showTrend}
            showForecast={showForecast}
          />
        </Suspense>
      </div>
      {projectCycles.length > 0 && (
        <CycleRail
          labels={chartData.map((r) => String(r.date))}
          projects={projectCycles}
          granularity={granularity}
          dualAxis
          moreCount={Math.max(0, projectCycles.length - 3)}
        />
      )}

      <div className="grid-2">
        <div>
          <h3>Cost by product</h3>
          <div style={{ height: 240 }}>
            <Suspense fallback={<p className="muted">Loading chart…</p>}>
              <CostByProductChart productTotals={ov.productTotals} />
            </Suspense>
          </div>
        </div>
        <div>
          <h3>Product totals</h3>
          <SortableTable
            columns={productColumns}
            rows={ov.productTotals}
            rowKey={(r) => r.product}
            initialSort="costCents"
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <p className="label muted">
        {label}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}
