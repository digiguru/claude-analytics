import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { groupRow, groupRowWithPrimary } from "../__tests__/groupRow.js";
import { GroupTotalsChart, type Metric } from "./GroupTotalsChart.js";

// The <label>/<select> pairs here are adjacent siblings, not htmlFor/id-
// associated, so getByLabelText can't find them.
function selectNear(labelText: string) {
  return within(screen.getByText(labelText).parentElement!).getByRole("combobox");
}

const metrics: Metric[] = [
  { key: "costCents", label: "Total cost", money: true },
  { key: "totalTokens", label: "Total tokens" },
  { key: "avgCostPerSeat", label: "Avg cost / seat", money: true, ratio: true },
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

// ---- "Breakdown by": the control the table below shares with this chart.

function breakdownChart(overrides: Partial<Parameters<typeof GroupTotalsChart>[0]> = {}) {
  return render(
    <GroupTotalsChart
      dimensionLabel="Project"
      metric={metrics[0]!}
      metrics={metrics}
      onMetricChange={vi.fn()}
      sortOrder="size"
      onSortOrderChange={vi.fn()}
      showDateSort={false}
      orderedGroups={[groupRow({ key: "Alpha", costCents: 300 }), groupRow({ key: "Beta", costCents: 100 })]}
      secondary="@team"
      onSecondaryChange={vi.fn()}
      secondaryOptions={[{ id: "@team", label: "Team" }]}
      secondaryLabel="Team"
      secondaryDimension="@team"
      secondaryRows={[
        groupRowWithPrimary({ key: "Team A", primaryKey: "Alpha", costCents: 200 }),
        groupRowWithPrimary({ key: "Team B", primaryKey: "Alpha", costCents: 100 }),
        groupRowWithPrimary({ key: "Team A", primaryKey: "Beta", costCents: 100 }),
      ]}
      {...overrides}
    />,
  );
}

test("GroupTotalsChart: no breakdown options hides the picker", () => {
  breakdownChart({ secondaryOptions: [], secondaryDimension: null, secondaryRows: [] });
  expect(screen.queryByText("Breakdown by")).not.toBeInTheDocument();
});

test("GroupTotalsChart: picking a breakdown dimension reports it", async () => {
  const onSecondaryChange = vi.fn();
  const user = userEvent.setup();
  breakdownChart({ secondary: "", secondaryDimension: null, secondaryRows: [], onSecondaryChange });
  await user.selectOptions(selectNear("Breakdown by"), "@team");
  expect(onSecondaryChange).toHaveBeenCalledWith("@team");
});

test("GroupTotalsChart: a resolved breakdown stacks one coloured series per secondary key", () => {
  const { container } = breakdownChart();
  expect(screen.getByText("Total cost by Project, split by Team")).toBeInTheDocument();
  // One <Bar> per secondary key, all sharing a stack — plus a legend naming them.
  expect(container.querySelectorAll(".recharts-bar").length).toBe(2);
  expect(screen.getByText("Team A")).toBeInTheDocument();
  expect(screen.getByText("Team B")).toBeInTheDocument();
});

// The bar heights still come from the metric, not the breakdown: the segments
// sum back to each group's own figure, so the value axis still tops out at the
// largest group total ($3.00) rather than at its largest single segment.
// Recharts renders no rect geometry under jsdom, but its axis ticks are real.
test("GroupTotalsChart: a stacked breakdown keeps the metric's own scale", () => {
  const { container } = breakdownChart();
  const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((t) => t.textContent);
  expect(ticks).toContain("$3.00");
});

test("GroupTotalsChart: until the breakdown response lands, the plain single-series bars stay", () => {
  const { container } = breakdownChart({ secondaryDimension: null, secondaryRows: [] });
  expect(container.querySelectorAll(".recharts-bar").length).toBe(1);
  expect(screen.getByText("Total cost by Project")).toBeInTheDocument();
});

test("GroupTotalsChart: a ratio metric's breakdown is grouped, not stacked, and says why", () => {
  const { container } = breakdownChart({
    metric: metrics[2]!,
    orderedGroups: [groupRow({ key: "Alpha", avgCostPerSeat: 300 })],
    secondaryRows: [
      groupRowWithPrimary({ key: "Team A", primaryKey: "Alpha", avgCostPerSeat: 200 }),
      groupRowWithPrimary({ key: "Team B", primaryKey: "Alpha", avgCostPerSeat: 100 }),
    ],
  });
  expect(screen.getByText(/is an average, not a total/)).toBeInTheDocument();
  expect(container.querySelectorAll(".recharts-bar").length).toBe(2);
  // Side-by-side, so the axis tops out at the largest single average ($2.00),
  // not at the meaningless $3.00 a stack of them would imply.
  const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((t) => t.textContent);
  expect(ticks).toContain("$2.00");
  expect(ticks).not.toContain("$3.00");
});
