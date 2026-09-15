import { usd } from "../api.js";

/** Recharts <Tooltip content>: the default per-series list, plus a "Total"
 *  row summing every stacked series at the hovered bucket. */
export function StackedCostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
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
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span className="muted" style={{ flex: 1 }}>
            {p.name}
          </span>
          <span>{usd((Number(p.value) || 0) * 100)}</span>
        </div>
      ))}
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #2a2f3a" }}>
        Total: <strong>{usd(total * 100)}</strong>
      </div>
    </div>
  );
}
