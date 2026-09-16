import { usd } from "../api.js";

/** Recharts <Tooltip content>: the default per-series list, plus a "Total"
 *  row summing every stacked series at the hovered bucket.
 *
 *  Defaults to dollars and always shows every series (what "Cost over time"
 *  wants); the totals chart overrides both — its metric may be tokens or a
 *  plain count, its stack can be 8 keys deep while a given group only touches
 *  one, and a ratio metric has no meaningful sum. */
export function StackedCostTooltip({
  active,
  payload,
  label,
  format = usd,
  showTotal = true,
  hideEmpty = false,
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
  /** How to render each figure (and the total). Defaults to `usd`. */
  format?: (v: number) => string | number;
  /** Drop the summing "Total" row — for metrics that don't add up (averages). */
  showTotal?: boolean;
  /** Drop series with no value at this point, rather than listing them as zero. */
  hideEmpty?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = hideEmpty ? payload.filter((p) => Number(p.value) !== 0 && p.value != null) : payload;
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  return (
    <div
      style={{
        background: "#1a1d24",
        border: "1px solid #2a2f3a",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <strong>{label}</strong>
      </div>
      {rows.map((p, i) => (
        // dataKey is optional in recharts' own payload type — falling back to
        // name, then the index, keeps keys unique even when it's absent
        // rather than risking duplicate `undefined` keys. See #30 item 7.
        <div key={p.dataKey ?? p.name ?? i} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span className="muted" style={{ flex: 1 }}>
            {p.name}
          </span>
          <span>{format(Number(p.value) || 0)}</span>
        </div>
      ))}
      {showTotal && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #2a2f3a" }}>
          Total: <strong>{format(total)}</strong>
        </div>
      )}
    </div>
  );
}
