import { useMemo, useState } from "react";
import { SortableTable, type Column } from "./SortableTable.js";

interface Props<T extends { key: string }> {
  columns: Column<T>[];
  /** Primary-level rows, already sorted per the page's sort control. */
  primaryRows: T[];
  /** Every primary group's secondary breakdown, flat — grouped here by primaryKey. */
  secondaryRows: (T & { primaryKey: string })[];
  secondaryLabel: string;
}

/**
 * A drill-down table: one row per primary group (same columns/values as the
 * flat table), expandable to reveal its breakdown by a secondary dimension —
 * mirrors the expand/detail-row pattern already used for a member's daily
 * cost-by-product drill-down (see MembersView's DailyTable).
 */
export function NestedGroupsTable<T extends { key: string }>({
  columns,
  primaryRows,
  secondaryRows,
  secondaryLabel,
}: Props<T>) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byPrimary = useMemo(() => {
    const m = new Map<string, (T & { primaryKey: string })[]>();
    for (const r of secondaryRows) {
      let list = m.get(r.primaryKey);
      if (!list) m.set(r.primaryKey, (list = []));
      list.push(r);
    }
    return m;
  }, [secondaryRows]);

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 18 }} />
          {columns.map((c) => (
            <th key={c.key} className={c.numeric ? "num" : ""}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {primaryRows.map((row) => {
          const subRows = byPrimary.get(row.key) ?? [];
          const isOpen = expanded === row.key;
          return [
            <tr
              key={row.key}
              className={subRows.length ? "day-row" : ""}
              onClick={() => subRows.length > 0 && setExpanded((e) => (e === row.key ? null : row.key))}
              title={subRows.length > 0 ? `Show breakdown by ${secondaryLabel}` : undefined}
            >
              <td className="muted">{subRows.length ? (isOpen ? "▾" : "▸") : ""}</td>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : ""}>
                  {c.render ? c.render(row) : c.value(row)}
                </td>
              ))}
            </tr>,
            isOpen && subRows.length > 0 && (
              <tr key={`${row.key}-detail`} className="day-detail">
                <td />
                <td colSpan={columns.length}>
                  <span className="muted" style={{ display: "block", marginBottom: 6 }}>
                    Breakdown by {secondaryLabel}:
                  </span>
                  <SortableTable columns={columns} rows={subRows} rowKey={(r) => r.key} initialSort="costCents" />
                </td>
              </tr>
            ),
          ];
        })}
        {primaryRows.length === 0 && (
          <tr>
            <td colSpan={columns.length + 1} className="muted">
              No data.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
