import { usd } from "../api.js";

/** The per-series colour dot + label + dollar figure rows shared by the "All
 *  dates total" / "Selected total" stat blocks and each region summary card —
 *  extracted from GroupsView (#29) to kill the triple duplication. Renders
 *  nothing when there's only one series (nothing to break down). */
export function KeyBreakdownRows({
  keys,
  byKey,
  colors,
  outerMuted = false,
}: {
  keys: string[];
  byKey: Map<string, number>;
  colors: Map<string, string>;
  /** The two "totals" stat blocks use a smaller, muted outer row; region
   *  summary cards (already small/muted via their container) don't. */
  outerMuted?: boolean;
}) {
  if (keys.length <= 1) return null;
  return (
    <>
      {keys
        .filter((k) => byKey.has(k))
        .map((k) => (
          <div
            key={k}
            className={outerMuted ? "row muted" : "row"}
            style={outerMuted ? { gap: 6, alignItems: "center", fontSize: 12 } : { gap: 6, alignItems: "center" }}
          >
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: colors.get(k), display: "inline-block" }}
            />
            <span className="muted" style={{ flex: 1 }}>
              {k}
            </span>
            <span>{usd(byKey.get(k) ?? 0)}</span>
          </div>
        ))}
    </>
  );
}
