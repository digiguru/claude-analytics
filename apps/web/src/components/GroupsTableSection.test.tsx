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
