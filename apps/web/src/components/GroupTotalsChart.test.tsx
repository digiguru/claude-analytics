import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { groupRow } from "../__tests__/groupRow.js";
import { GroupTotalsChart, type Metric } from "./GroupTotalsChart.js";

// The <label>/<select> pairs here are adjacent siblings, not htmlFor/id-
// associated, so getByLabelText can't find them.
function selectNear(labelText: string) {
  return within(screen.getByText(labelText).parentElement!).getByRole("combobox");
}

const metrics: Metric[] = [
  { key: "costCents", label: "Total cost", money: true },
  { key: "totalTokens", label: "Total tokens" },
];

test("GroupTotalsChart: renders a title and a chart container for the ordered groups", () => {
  const { container } = render(
    <GroupTotalsChart
      dimensionLabel="Project"
      metric={metrics[0]!}
      metrics={metrics}
      onMetricChange={vi.fn()}
      sortOrder="size"
      onSortOrderChange={vi.fn()}
      showDateSort={false}
      orderedGroups={[groupRow({ key: "Alpha", costCents: 1000 })]}
    />,
  );
  expect(screen.getByText("Total cost by Project")).toBeInTheDocument();
  // ResponsiveContainer is mocked to a fixed-size div (see testSetup.ts) —
  // this proves the chart actually mounted with data, not pixel geometry.
  expect(container.querySelector(".recharts-bar")).toBeInTheDocument();
});

test("GroupTotalsChart: changing the metric/sort selects reports the new value", async () => {
  const onMetricChange = vi.fn();
  const onSortOrderChange = vi.fn();
  const user = userEvent.setup();
  render(
    <GroupTotalsChart
      dimensionLabel="Project"
      metric={metrics[0]!}
      metrics={metrics}
      onMetricChange={onMetricChange}
      sortOrder="size"
      onSortOrderChange={onSortOrderChange}
      showDateSort={false}
      orderedGroups={[]}
    />,
  );
  await user.selectOptions(selectNear("Chart metric"), "totalTokens");
  expect(onMetricChange).toHaveBeenCalledWith("totalTokens");
  await user.selectOptions(selectNear("Sort order"), "alpha");
  expect(onSortOrderChange).toHaveBeenCalledWith("alpha");
});

test("GroupTotalsChart: the Date sort option only appears when showDateSort is true", () => {
  render(
    <GroupTotalsChart
      dimensionLabel="Cycle"
      metric={metrics[0]!}
      metrics={metrics}
      onMetricChange={vi.fn()}
      sortOrder="size"
      onSortOrderChange={vi.fn()}
      showDateSort
      orderedGroups={[]}
    />,
  );
  expect(screen.getByRole("option", { name: "Date" })).toBeInTheDocument();
});
