import type { GroupRow, GroupsResponse } from "../api.js";
import { NestedGroupsTable } from "./NestedGroupsTable.js";
import { SortableTable, type Column } from "./SortableTable.js";
import type { SortOrder } from "./GroupTotalsChart.js";

/** The table breakdown: either the nested (secondary-grouped) or flat table.
 *  Extracted from GroupsView (#29).
 *
 *  The "Breakdown by" picker itself lives up in GroupTotalsChart — one control
 *  drives both the chart's stacking and this table's expandable rows — so all
 *  this section adds is the hint telling you the rows are expandable. */
export function GroupsTableSection({
  columns,
  orderedGroups,
  data,
  secondaryLabel,
  sortOrder,
  metricKey,
}: {
  columns: Column<GroupRow>[];
  orderedGroups: GroupRow[];
  data: GroupsResponse;
  secondaryLabel: string;
  sortOrder: SortOrder;
  metricKey: string;
}) {
  return (
    <>
      {data.secondaryDimension ? (
        <>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Expand a row below to see its breakdown by {secondaryLabel}.
          </p>
          <NestedGroupsTable
            columns={columns}
            primaryRows={orderedGroups}
            secondaryRows={data.secondaryGroups}
            secondaryLabel={secondaryLabel}
          />
        </>
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
