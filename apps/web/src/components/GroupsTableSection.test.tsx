import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
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

test("GroupsTableSection: no secondary options hides the drill-down picker, shows the flat table", () => {
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Alpha" })]}
      data={response()}
      secondary=""
      onSecondaryChange={vi.fn()}
      secondaryOptions={[]}
      secondaryLabel=""
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  expect(screen.queryByText("Table breakdown by")).not.toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
});

test("GroupsTableSection: picking a secondary dimension reports it", async () => {
  const onSecondaryChange = vi.fn();
  const user = userEvent.setup();
  render(
    <GroupsTableSection
      columns={columns}
      orderedGroups={[groupRow({ key: "Alpha" })]}
      data={response()}
      secondary=""
      onSecondaryChange={onSecondaryChange}
      secondaryOptions={[{ id: "@team", label: "Team" }]}
      secondaryLabel=""
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  await user.selectOptions(screen.getByRole("combobox"), "@team");
  expect(onSecondaryChange).toHaveBeenCalledWith("@team");
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
      secondary="@team"
      onSecondaryChange={vi.fn()}
      secondaryOptions={[{ id: "@team", label: "Team" }]}
      secondaryLabel="Team"
      sortOrder="size"
      metricKey="costCents"
    />,
  );
  expect(screen.getByText(/Expand a row below to see its breakdown by Team/)).toBeInTheDocument();
  expect(screen.queryByText("No data.")).not.toBeInTheDocument(); // primaryRows has one row
});
