import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import { groupRow, groupRowWithPrimary } from "../__tests__/groupRow.js";
import { GroupsTableSection } from "./GroupsTableSection.js";
import type { GroupsResponse } from "../api.js";
import type { Column } from "./SortableTable.js";
import type { GroupRow } from "../api.js";

const columns: Column<GroupRow>[] = [{ key: "key", label: "Group", value: (r) => r.key }];

function response(overrides: Partial<GroupsResponse> = {}): GroupsResponse {
  return {
    dimension: "@project",
    product: null,
    groups: [],
    timeseries: [],
    keys: [],
    activeProjects: [],
    secondaryDimension: null,
    secondaryGroups: [],
    unmatchedCount: 0,
    ...overrides,
  };
}

test("GroupsTableSection: no secondary dimension shows the flat table and no drill-down hint", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Alpha" })]}
      data={response()}
      secondaryLabel=""
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByText(/Expand a row below/)).not.toBeInTheDocument();
});

// The picker itself now lives in GroupTotalsChart (one "Breakdown by" control
// drives both the chart's stacking and this table's expandable rows), so this
// section must never grow a second one.
test("GroupsTableSection: renders no breakdown picker of its own", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Alpha" })]}
      data={response({
        secondaryDimension: "@team",
        secondaryGroups: [groupRowWithPrimary({ key: "Team A", primaryKey: "Alpha" })],
      })}
      secondaryLabel="Team"
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test("GroupsTableSection: a resolved secondary dimension renders the nested drill-down table", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Alpha" })]}
      data={response({
        secondaryDimension: "@team",
        secondaryGroups: [groupRowWithPrimary({ key: "Team A", primaryKey: "Alpha" })],
      })}
      secondaryLabel="Team"
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  expect(screen.getByText(/Expand a row below to see its breakdown by Team/)).toBeInTheDocument();
  expect(screen.queryByText("No data.")).not.toBeInTheDocument(); // primaryRows has one row
});

// The flat table seeds SortableTable from the page's "Sort order": "Size
// (metric)" hands it the metric column descending, anything else hands it the
// group name ascending. Without a breakdown this is the only thing this
// section decides, so both ways through it are worth pinning.
test("GroupsTableSection: a non-metric sort order seeds the flat table by name, ascending", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Beta" }), groupRow({ key: "Alpha" })]}
      data={response()}
      secondaryLabel=""
      sortOrder="alpha"
      metricKey="costCents"
    />,
  );
  expect(screen.getByRole("columnheader")).toHaveTextContent("Group ▲"); // ascending
  expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["Alpha", "Beta"]);
});

test("GroupsTableSection: the metric sort order seeds it by the metric column instead", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Beta" }), groupRow({ key: "Alpha" })]}
      data={response()}
      secondaryLabel=""
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  // costCents isn't one of this table's columns, so nothing is re-sorted and
  // the page's own metric ordering is left exactly as handed over.
  expect(screen.getByRole("columnheader")).toHaveTextContent("Group");
  expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["Beta", "Alpha"]);
});
