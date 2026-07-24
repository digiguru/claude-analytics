import type { Granularity } from "../series.js";

interface Props {
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  showTrend: boolean;
  onTrend: (v: boolean) => void;
  showForecast: boolean;
  onForecast: (v: boolean) => void;
}

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/** Grouping + trend/forecast toggles shared by the time-series charts. */
export function SeriesControls({ granularity, onGranularity, showTrend, onTrend, showForecast, onForecast }: Props) {
  return (
    <div className="series-controls">
      <div className="segmented" role="group" aria-label="Group by">
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            className={granularity === g.key ? "active" : ""}
            onClick={() => onGranularity(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <label className="series-check">
        <input type="checkbox" checked={showTrend} onChange={(e) => onTrend(e.target.checked)} />
        <span>Trend line</span>
      </label>
      <label className="series-check">
        <input type="checkbox" checked={showForecast} onChange={(e) => onForecast(e.target.checked)} />
        <span>Forecast</span>
      </label>
    </div>
  );
}
