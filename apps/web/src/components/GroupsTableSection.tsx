import type { GroupRow, GroupsResponse } from "../api.js";
import { NestedGroupsTable } from "./NestedGroupsTable.js";
import { SortableTable, type Column } from "./SortableTable.js";
import type { SortOrder } from "./GroupTotalsChart.js";

/** The table breakdown: a "Table breakdown by" secondary-dimension picker,
 *  then either the nested (secondary-grouped) or flat table. Extracted from
 *  GroupsView (#29). */
export function GroupsTableSection({
  columns,
  orderedGroups,
  data,
  secondary,
  onSecondaryChange,
  secondaryOptions,
  secondaryLabel,
  sortOrder,
  metricKey,
}: {
  columns: Column<GroupRow>[];
  orderedGroups: GroupRow[];
  data: GroupsResponse;
  secondary: string;
  onSecondaryChange: (v: string) => void;
  secondaryOptions: { id: string; label: string }[];
  secondaryLabel: string;
  sortOrder: SortOrder;
  metricKey: string;
}) {
  return (
    <>
      {secondaryOptions.length > 0 && (
        <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
          <div>
            <label>Table breakdown by</label>
            <select value={secondary} onChange={(e) => onSecondaryChange(e.target.value)}>
              <option value="">None</option>
              {secondaryOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          {secondary && (
            <p className="muted" style={{ margin: 0 }}>
              Expand a row below to see its breakdown by {secondaryLabel}.
            </p>
          )}
        </div>
      )}

      {data.secondaryDimension ? (
        <NestedGroupsTable
          columns={columns}
          primaryRows={orderedGroups}
          secondaryRows={data.secondaryGroups}
          secondaryLabel={secondaryLabel}
        />
      ) : (
        <SortableTable
          columns={columns}
          rows={orderedGroups}
          rowKey={(r) => r.key}
          initialSort={sortOrder === "size" ? metricKey : "key"}
          initialDesc={sortOrder === "size"}
        />
      )}
    </>
  );
}
