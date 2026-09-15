import { useState } from "react";
import { usd } from "../api.js";
import { wrapLabel } from "../charts.js";

interface Props {
  /** One row per bucket, each carrying `date` (its display label), `days`
   *  (its real calendar span), and a numeric value per entry in `keys`. */
  rows: Record<string, number | string | null>[];
  /** Stacking keys, in bottom-to-top order (matches the equal-width chart). */
  keys: string[];
  colors: Map<string, string>;
  height?: number;
}

const Y_TICKS = 4;

/**
 * A stacked bar chart where each bar's WIDTH is proportional to its `days`
 * (a cycle's real duration) and its HEIGHT is proportional to the stacked
 * value (cost) on a shared scale — plain proportional bars, not a
 * width-times-height "volume"/mekko encoding (that reads two values at once
 * and is hard to scan; here each axis reads on its own, like any bar chart).
 * Recharts' BarChart can't do this (its category axis always gives equal
 * band widths), so this is a small hand-built replacement used only for the
 * "Cycle" granularity, where equal-width bars would misrepresent cycles of
 * very different lengths.
 */
export function VariableWidthBars({ rows, keys, colors, height = 260 }: Props) {
  const [hover, setHover] = useState<{ row: number; key: string } | null>(null);

  if (rows.length === 0) return null;

  const totalDays = rows.reduce((s, r) => s + (Number(r.days) || 0), 0) || 1;
  const rowTotal = (r: Record<string, number | string | null>) => keys.reduce((s, k) => s + (Number(r[k]) || 0), 0);
  const maxTotal = Math.max(1, ...rows.map(rowTotal));

  const plotHeight = height - 36; // leave room for the x-axis label row
  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxTotal * i) / Y_TICKS);

  return (
    <div className="varwidth-chart">
      <div className="varwidth-plot" style={{ height: plotHeight }}>
        <div className="varwidth-yaxis">
          {yTicks
            .slice()
            .reverse()
            .map((v) => (
              <span key={v} className="varwidth-ytick">
                {usd(v * 100)}
              </span>
            ))}
        </div>
        <div className="varwidth-bars">
          {yTicks.map((v) => (
            <div key={v} className="varwidth-gridline" style={{ bottom: `${(v / maxTotal) * 100}%` }} />
          ))}
          {rows.map((row, i) => {
            const days = Number(row.days) || 1;
            const widthPct = (days / totalDays) * 100;
            return (
              <div key={String(row.date)} className="varwidth-bar" style={{ flexBasis: `${widthPct}%` }}>
                <div className="varwidth-stack">
                  {keys.map((k) => {
                    const v = Number(row[k]) || 0;
                    if (v <= 0) return null;
                    const isHovered = hover?.row === i && hover.key === k;
                    return (
                      <div
                        key={k}
                        className="varwidth-segment"
                        style={{
                          height: `${(v / maxTotal) * 100}%`,
                          background: colors.get(k) ?? "#5c6270",
                          opacity: isHovered ? 1 : 0.92,
                        }}
                        onMouseEnter={() => setHover({ row: i, key: k })}
                        onMouseLeave={() => setHover((h) => (h?.row === i && h.key === k ? null : h))}
                      >
                        {isHovered && (
                          <div className="varwidth-tooltip">
                            <div>{String(row.date)}</div>
                            <div className="muted">
                              {k}: {usd(v * 100)}
                            </div>
                            <div className="muted">
                              {row.start} – {row.end} ({days} day{days === 1 ? "" : "s"})
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="varwidth-xaxis">
        {rows.map((row) => {
          const days = Number(row.days) || 1;
          const widthPct = (days / totalDays) * 100;
          const lines = wrapLabel(String(row.date), 14, 2);
          return (
            <div key={String(row.date)} className="varwidth-xlabel" style={{ flexBasis: `${widthPct}%` }}>
              {lines.map((ln, i) => (
                <div key={i}>{ln}</div>
              ))}
              <div className="muted">{days}d</div>
            </div>
          );
        })}
      </div>
      {keys.length > 0 && (
        <div className="varwidth-legend">
          {keys.map((k) => (
            <span key={k} className="varwidth-legend-item">
              <span className="varwidth-legend-swatch" style={{ background: colors.get(k) ?? "#5c6270" }} />
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
