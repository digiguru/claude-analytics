import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect } from "vitest";
import { groupRow, groupRowWithPrimary } from "../__tests__/groupRow.js";
import type { Column } from "./SortableTable.js";
import { NestedGroupsTable } from "./NestedGroupsTable.js";
import type { GroupRow } from "../api.js";

const columns: Column<GroupRow>[] = [{ key: "key", label: "Group", value: (r) => r.key }];

test("NestedGroupsTable: no primary rows shows the empty state", () => {
  render(<NestedGroupsTable columns={columns} primaryRows={[]} secondaryRows={[]} secondaryLabel="Team" />);
  expect(screen.getByText("No data.")).toBeInTheDocument();
});

test("NestedGroupsTable: a primary row with no secondary breakdown isn't expandable", () => {
  render(
    <NestedGroupsTable
      columns={columns}
      primaryRows={[groupRow({ key: "Alpha" })]}
      secondaryRows={[]}
      secondaryLabel="Team"
    />,
  );
  const row = screen.getByText("Alpha").closest("tr")!;
  expect(row).not.toHaveClass("day-row");
});

test("NestedGroupsTable: expanding a row reveals its secondary breakdown", async () => {
  const user = userEvent.setup();
  render(
    <NestedGroupsTable
      columns={columns}
      primaryRows={[groupRow({ key: "Alpha" })]}
      secondaryRows={[groupRowWithPrimary({ key: "sub-1", primaryKey: "Alpha" })]}
      secondaryLabel="Team"
    />,
  );
  expect(screen.queryByText("sub-1")).not.toBeInTheDocument();
  await user.click(screen.getByText("Alpha"));
  expect(screen.getByText("sub-1")).toBeInTheDocument();
  expect(screen.getByText("Breakdown by Team:")).toBeInTheDocument();

  // Clicking again collapses it.
  await user.click(screen.getByText("Alpha"));
  expect(screen.queryByText("sub-1")).not.toBeInTheDocument();
});
