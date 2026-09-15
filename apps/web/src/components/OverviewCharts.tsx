// The two recharts-backed charts on the Overview tab, split out of
// OverviewView so they can be lazy()-loaded. recharts and its transitive deps
// are ~391 kB of the build — over half of it — and Overview is the default
// tab, so importing them here keeps them off the first-paint critical path:
// the stat grid and product table render on the app + react chunks alone,
// and this chunk arrives behind a placeholder. Everything else Overview
// renders (CycleRail, SeriesControls, SortableTable) is recharts-free and
// stays eager.
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
import type { Overview } from "../api.js";
import { CHART_MARGIN, COLORS, Y_AXIS_WIDTH, xAxisProps } from "../charts.js";

/** Mirrors the (unexported) row shape `prepareSeries` returns. */
type Row = Record<string, number | string | null>;

interface CostAndUsersProps {
  chartData: Row[];
  dauLabel: string;
  showTrend: boolean;
  showForecast: boolean;
}

export function CostAndUsersChart({ chartData, dauLabel, showTrend, showForecast }: CostAndUsersProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
        <XAxis
          dataKey="date"
          stroke="#9aa3b2"
          fontSize={11}
          {...xAxisProps(chartData.length, 10, { rotateWhenShort: true })}
        />
        <YAxis yAxisId="l" stroke="#d97757" fontSize={11} width={Y_AXIS_WIDTH} />
        <YAxis yAxisId="r" orientation="right" stroke="#5a6b8c" fontSize={11} width={Y_AXIS_WIDTH} />
        <Tooltip
          contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
          formatter={(v, n) =>
            typeof n === "string" && n.startsWith("cost") ? `$${Number(v ?? 0).toFixed(2)}` : Number(v ?? 0)
          }
        />
        <Legend />
        <Bar yAxisId="l" dataKey="cost" name="cost ($)" fill="#d97757" />
        {showForecast && (
          <Bar yAxisId="l" dataKey="costForecast" name="cost (forecast)" fill="#d97757" fillOpacity={0.35} />
        )}
        {showTrend && (
          <Line
            yAxisId="l"
            dataKey="trend"
            name="cost trend"
            stroke="#c0a96b"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
          />
        )}
        <Line yAxisId="r" dataKey="dau" name={dauLabel} stroke="#7fae7f" strokeWidth={2} dot={false} connectNulls />
        <Line
          yAxisId="l"
          dataKey="cpd"
          name="cost/active user ($)"
          stroke="#6b9bc0"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CostByProductChart({ productTotals }: { productTotals: Overview["productTotals"] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={productTotals.map((p) => ({ name: p.product, cost: p.costCents / 100 }))} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
        <XAxis type="number" stroke="#9aa3b2" fontSize={11} />
        <YAxis type="category" dataKey="name" width={100} stroke="#9aa3b2" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
          formatter={(v) => `$${Number(v ?? 0).toFixed(2)}`}
        />
        <Bar dataKey="cost" name="cost ($)">
          {productTotals.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
