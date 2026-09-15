import { useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  value: (row: T) => string | number;
  render?: (row: T) => string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  initialSort?: string;
  initialDesc?: boolean;
}

export function SortableTable<T>({ columns, rows, initialSort, initialDesc = true }: Props<T>) {
  const [sortKey, setSortKey] = useState(initialSort ?? columns[0]?.key ?? "");
  const [desc, setDesc] = useState(initialDesc);

  // Follow the caller's sort when it changes (e.g. the Groups page sort-order
  // control), while still allowing the user to re-sort by clicking column
  // headers afterwards. Adjusted during render (comparing against the last
  // props seen) rather than in an effect — an effect here would apply the
  // new sort one render late, and calling setState synchronously inside an
  // effect body is itself flagged by react-hooks/set-state-in-effect. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [prevProps, setPrevProps] = useState({ initialSort, initialDesc });
  if (prevProps.initialSort !== initialSort || prevProps.initialDesc !== initialDesc) {
    setPrevProps({ initialSort, initialDesc });
    if (initialSort) setSortKey(initialSort);
    setDesc(initialDesc);
  }

  const col = columns.find((c) => c.key === sortKey);
  const sorted = [...rows].sort((a, b) => {
    if (!col) return 0;
    const av = col.value(a);
    const bv = col.value(b);
    if (typeof av === "number" && typeof bv === "number") return desc ? bv - av : av - bv;
    return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  });

  function toggle(key: string) {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.numeric ? "num" : ""} onClick={() => toggle(c.key)}>
              {c.label}
              {sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key} className={c.numeric ? "num" : ""}>
                {c.render ? c.render(row) : c.value(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
