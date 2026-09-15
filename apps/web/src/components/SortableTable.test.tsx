import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect } from "vitest";
import { SortableTable, type Column } from "./SortableTable.js";

interface Row {
  name: string;
  cost: number;
}

const columns: Column<Row>[] = [
  { key: "name", label: "Name", value: (r) => r.name },
  { key: "cost", label: "Cost", numeric: true, value: (r) => r.cost, render: (r) => `$${r.cost}` },
];

const rows: Row[] = [
  { name: "bob", cost: 5 },
  { name: "alice", cost: 20 },
  { name: "carol", cost: 10 },
];

function rowOrder() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent);
}

test("SortableTable: sorts descending by the initial sort key by default", () => {
  render(<SortableTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort="cost" />);
  expect(rowOrder().map((t) => t!.split("$")[0])).toEqual(["alice", "carol", "bob"]);
});

test("SortableTable: clicking a different column header switches to it, descending first", async () => {
  const user = userEvent.setup();
  render(<SortableTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort="cost" />);
  await user.click(screen.getByText("Name"));
  expect(rowOrder()).toEqual(["carol$10", "bob$5", "alice$20"]);
});

test("SortableTable: clicking the active column again reverses direction", async () => {
  const user = userEvent.setup();
  render(<SortableTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort="cost" />);
  expect(rowOrder().map((t) => t!.split("$")[0])).toEqual(["alice", "carol", "bob"]);
  await user.click(screen.getByText(/Cost/));
  expect(rowOrder().map((t) => t!.split("$")[0])).toEqual(["bob", "carol", "alice"]);
});

test("SortableTable: uses render() over value() for cell display when provided", () => {
  render(<SortableTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort="cost" />);
  expect(screen.getAllByText(/^\$\d+$/).length).toBe(rows.length);
});

// #30 item 6: rows used to key by array index, so React could reuse the
// wrong row's DOM node across a re-sort. Each row's identity should follow
// its own rowKey instead, tracking the same <tr> element as it moves.
test("SortableTable: a row keeps its own DOM node identity across a re-sort", async () => {
  const user = userEvent.setup();
  render(<SortableTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort="name" initialDesc={false} />);
  const beforeRows = screen.getAllByRole("row").slice(1);
  const bobRowBefore = beforeRows.find((r) => r.textContent?.startsWith("bob"))!;

  await user.click(screen.getByText(/Cost/)); // re-sort by cost, moving bob's position

  const afterRows = screen.getAllByRole("row").slice(1);
  const bobRowAfter = afterRows.find((r) => r.textContent?.startsWith("bob"))!;
  expect(bobRowAfter).toBe(bobRowBefore);
});
