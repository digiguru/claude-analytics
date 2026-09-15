import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usd, type ProjectCycles } from "../api.js";
import { CHART_MARGIN, Y_AXIS_WIDTH, wrapLabel, xAxisProps } from "../charts.js";
import { RechartsReferenceArea as ReferenceArea } from "../RechartsReferenceArea.js";
import { snapBand, type ChartBucket } from "../cycles.js";
import type { ActiveDrag, DragRegion } from "../dragSelection.js";
import type { Granularity } from "../series.js";
import type { StackedSeries } from "../stack.js";
import { CycleRail } from "./CycleRail.js";
import { KeyBreakdownRows } from "./KeyBreakdownRows.js";
import { StackedCostTooltip } from "./StackedCostTooltip.js";
import { VariableWidthBars } from "./VariableWidthBars.js";

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export interface RegionSummary {
  total: number;
  byKey: Map<string, number>;
  x1: string;
  x2: string;
}

/**
 * The "Cost over time" section: granularity controls, the two totals stat
 * blocks, the stacked bar chart (or VariableWidthBars for Cycle granularity)
 * with click-and-drag range selection, and the cycle rail. Extracted from
 * GroupsView (#29) — every value here is a prop; the drag-selection state
 * machine itself lives in dragSelection.ts, GroupsView owns the reducer.
 *
 * The granularity buttons reflect the *resolved* `bucket` (never `bucketRaw`
 * directly) — see cycles.ts's resolveBucket for the fallback this depends
 * on (picking "Cycle" before it's actually available resolves to "week"
 * until cycleAvailable flips true, at which point this control's active
 * state follows along automatically).
 */
export function CostOverTimeChart({
  stacked,
  bucket,
  onBucketChange,
  cycleAvailable,
  showCycles,
  onToggleCycles,
  overallSummary,
  combinedRegionSummary,
  regionSummaries,
  stackColor,
  chartLabels,
  annotateBands,
  scopeCycles,
  railProjects,
  projectCycles,
  activeDrag,
  liveRegions,
  onChartMouseDown,
  onChartMouseMove,
  onCommitDrag,
  onRemoveRegion,
  onClearSelection,
}: {
  stacked: StackedSeries;
  bucket: ChartBucket;
  onBucketChange: (v: string) => void;
  cycleAvailable: boolean;
  showCycles: boolean;
  onToggleCycles: () => void;
  overallSummary: { total: number; byKey: Map<string, number> };
  combinedRegionSummary: { total: number; byKey: Map<string, number> } | null;
  regionSummaries: RegionSummary[];
  stackColor: Map<string, string>;
  chartLabels: string[];
  annotateBands: boolean;
  scopeCycles: ProjectCycles["cycles"];
  railProjects: ProjectCycles[];
  projectCycles: ProjectCycles[];
  activeDrag: ActiveDrag | null;
  liveRegions: (DragRegion & { rows: Record<string, number | string | null>[] })[];
  onChartMouseDown: (e: { activeLabel?: string | number }, event: { shiftKey?: boolean }) => void;
  onChartMouseMove: (e: { activeLabel?: string | number }) => void;
  onCommitDrag: () => void;
  onRemoveRegion: (index: number) => void;
  onClearSelection: () => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Cost over time</h3>
        <div className="segmented" role="group" aria-label="Granularity">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              className={bucket === g.key ? "active" : ""}
              onClick={() => onBucketChange(g.key)}
            >
              {g.label}
            </button>
          ))}
          {cycleAvailable && (
            <button
              type="button"
              className={bucket === "cycle" ? "active" : ""}
              onClick={() => onBucketChange("cycle")}
            >
              Cycle
            </button>
          )}
        </div>
        {(cycleAvailable || railProjects.length > 0) && (
          <button className="secondary" type="button" onClick={onToggleCycles}>
            {showCycles ? "Hide cycles" : "Show cycles"}
          </button>
        )}
      </div>
      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat">
          <p className="label muted">All dates total</p>
          <div className="value">{usd(overallSummary.total)}</div>
          <KeyBreakdownRows keys={stacked.keys} byKey={overallSummary.byKey} colors={stackColor} outerMuted />
        </div>
        {combinedRegionSummary && (
          <div className="stat">
            <p className="label muted">
              Selected total ({regionSummaries.length} region{regionSummaries.length === 1 ? "" : "s"})
            </p>
            <div className="value">{usd(combinedRegionSummary.total)}</div>
            <KeyBreakdownRows keys={stacked.keys} byKey={combinedRegionSummary.byKey} colors={stackColor} outerMuted />
          </div>
        )}
      </div>
      {bucket === "cycle" ? (
        // Recharts' BarChart always gives every category an equal-width band,
        // which would misrepresent cycles of very different lengths — use a
        // hand-built chart instead where bar width is proportional to each
        // cycle's real day-count (see VariableWidthBars).
        <VariableWidthBars rows={stacked.rows} keys={stacked.keys} colors={stackColor} height={280} />
      ) : (
        <div style={{ height: 280, position: "relative", userSelect: activeDrag ? "none" : undefined }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stacked.rows}
              margin={CHART_MARGIN}
              onMouseDown={onChartMouseDown}
              onMouseMove={onChartMouseMove}
              onMouseUp={onCommitDrag}
              onMouseLeave={onCommitDrag}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
              {annotateBands &&
                scopeCycles.map((c, i) => {
                  const span = snapBand(c, chartLabels, bucket);
                  if (!span) return null;
                  const x1Idx = chartLabels.indexOf(span.x1);
                  const x2Idx = chartLabels.indexOf(span.x2);
                  const wide = x2Idx - x1Idx >= 1;
                  return (
                    <ReferenceArea
                      key={c.name}
                      x1={span.x1}
                      x2={span.x2}
                      zIndex={1000}
                      fill="#ffffff"
                      fillOpacity={i % 2 ? 0.07 : 0.04}
                      stroke="#2a2f3a"
                      strokeDasharray="3 3"
                      label={
                        wide
                          ? {
                              value: wrapLabel(c.name, 18, 1)[0],
                              position: "insideTopLeft",
                              fill: "#9aa3b2",
                              fontSize: 11,
                            }
                          : undefined
                      }
                    />
                  );
                })}
              <XAxis
                dataKey="date"
                stroke="#9aa3b2"
                fontSize={11}
                {...xAxisProps(stacked.rows.length, 10, { rotateWhenShort: true })}
              />
              <YAxis stroke="#9aa3b2" fontSize={12} width={Y_AXIS_WIDTH} tickFormatter={(v: number) => usd(v)} />
              <Tooltip content={<StackedCostTooltip />} />
              <Legend />
              {stacked.keys.map((key) => (
                <Bar key={key} dataKey={key} stackId="groups" fill={stackColor.get(key)} name={key} />
              ))}
              {liveRegions.map((r, i) => (
                <ReferenceArea
                  key={`${r.x1}-${r.x2}-${i}`}
                  x1={r.x1}
                  x2={r.x2}
                  zIndex={1000}
                  stroke="#d97757"
                  strokeOpacity={0.6}
                  fill="#d97757"
                  fillOpacity={0.15}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {regionSummaries.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 12,
                zIndex: 30,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                pointerEvents: "none",
              }}
            >
              {regionSummaries.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  style={{ alignSelf: "flex-end", fontSize: 11, padding: "2px 8px", pointerEvents: "auto" }}
                  onClick={onClearSelection}
                >
                  Clear all
                </button>
              )}
              {regionSummaries.map((s, i) => (
                <div
                  key={`${s.x1}-${s.x2}-${i}`}
                  style={{
                    background: "#1a1d24",
                    border: "1px solid #2a2f3a",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 12,
                    lineHeight: 1.5,
                    pointerEvents: "auto",
                    maxWidth: 220,
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <strong>{s.x1 === s.x2 ? s.x1 : `${s.x1} – ${s.x2}`}</strong>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "0 6px", lineHeight: 1.3 }}
                      onClick={() => onRemoveRegion(i)}
                      aria-label="Remove selection"
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ marginBottom: stacked.keys.length > 1 ? 4 : 0 }}>
                    Total: <strong>{usd(s.total)}</strong>
                  </div>
                  <KeyBreakdownRows keys={stacked.keys} byKey={s.byKey} colors={stackColor} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {bucket !== "cycle" && (
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
          Drag to select a range · Shift-drag or shift-click to add another region
        </p>
      )}
      {showCycles && bucket !== "cycle" && railProjects.length > 0 && (
        <CycleRail
          labels={chartLabels}
          projects={railProjects.map((p) => ({ project: p.project, cycles: p.cycles }))}
          granularity={bucket}
          moreCount={Math.max(0, projectCycles.length - railProjects.length)}
        />
      )}
    </div>
  );
}
