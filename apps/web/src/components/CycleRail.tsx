import type { CSSProperties } from "react";
import { snapBand } from "../cycles.js";
import { CHART_MARGIN, Y_AXIS_WIDTH } from "../charts.js";
import type { Granularity } from "../series.js";
import type { CycleDef } from "../api.js";

interface Props {
  /** The chart's rendered category labels, in order (its x-axis data points). */
  labels: string[];
  /** Project -> its cycles, already limited to the ones worth showing (see MAX_LANES). */
  projects: { project: string; cycles: CycleDef[] }[];
  granularity: Granularity;
  /** How many more projects (beyond `projects`) have cycles but didn't make the cut. */
  moreCount?: number;
  /** True for a chart with a second (right-hand) y-axis (e.g. Overview's dual-axis
   *  chart) — widens the right gutter to match so the rail still lines up. */
  dualAxis?: boolean;
}

const MAX_LANES = 3;
const LANE_COLORS = ["#d97757", "#5a6b8c", "#7fae7f"]; // first 3 of the shared palette

/**
 * A labelled lane per project beneath a chart, showing each project's cycles as
 * chips positioned by a CSS grid with one column per rendered bucket — a
 * category axis divides the plot into equal bands, so an equal-column grid
 * lines up with the bars above it without touching the chart's SVG. Callers
 * must give the chart above matching PLOT_LEFT/PLOT_RIGHT gutters (charts.tsx).
 */
export function CycleRail({ labels, projects, granularity, moreCount, dualAxis }: Props) {
  if (labels.length === 0 || projects.length === 0) return null;
  const lanes = projects.slice(0, MAX_LANES);
  const trackStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${labels.length}, 1fr)`,
    ...(dualAxis ? { paddingRight: Y_AXIS_WIDTH + CHART_MARGIN.right } : {}),
  };

  return (
    <div className="cycle-rail">
      {lanes.map((p, laneIdx) => (
        <div className="cycle-rail-row" key={p.project}>
          <span className="cycle-rail-label" title={p.project}>
            {p.project}
          </span>
          <div className="cycle-rail-track" style={trackStyle}>
            {p.cycles.map((c) => {
              const span = snapBand(c, labels, granularity);
              if (!span) return null;
              const x1 = labels.indexOf(span.x1);
              const x2 = labels.indexOf(span.x2);
              return (
                <span
                  key={c.name}
                  className="cycle-chip"
                  style={{
                    gridColumn: `${x1 + 1} / ${x2 + 2}`,
                    background: LANE_COLORS[laneIdx % LANE_COLORS.length],
                  }}
                  title={`${p.project} · ${c.name} (${c.start} – ${c.end ?? "ongoing"})`}
                >
                  {c.name}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {moreCount ? <p className="muted cycle-rail-more">+{moreCount} more project(s) with cycles</p> : null}
    </div>
  );
}
