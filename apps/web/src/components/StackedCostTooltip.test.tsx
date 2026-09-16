import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import { StackedCostTooltip } from "./StackedCostTooltip.js";

test("StackedCostTooltip: renders nothing while inactive or with no payload", () => {
  const { container: inactive } = render(<StackedCostTooltip active={false} payload={[{ value: 5 }]} />);
  expect(inactive.firstChild).toBeNull();

  const { container: empty } = render(<StackedCostTooltip active payload={[]} />);
  expect(empty.firstChild).toBeNull();
});

test("StackedCostTooltip: lists each series plus a Total row summing them", () => {
  render(
    <StackedCostTooltip
      active
      label="2026-06-01"
      payload={[
        { dataKey: "Alpha", name: "Alpha", value: 1000, color: "#111" },
        { dataKey: "Beta", name: "Beta", value: 500, color: "#222" },
      ]}
    />,
  );
  expect(screen.getByText("2026-06-01")).toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("$10.00")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText("$5.00")).toBeInTheDocument();
  expect(screen.getByText("$15.00")).toBeInTheDocument(); // total
});

test("StackedCostTooltip: a missing value is treated as 0", () => {
  render(<StackedCostTooltip active payload={[{ dataKey: "Alpha", name: "Alpha" }]} />);
  expect(screen.getAllByText("$0.00").length).toBe(2); // the row and the total
});

test("StackedCostTooltip: format overrides the dollar default, showTotal drops the sum", () => {
  render(
    <StackedCostTooltip
      active
      label="Alpha"
      payload={[{ dataKey: "Team A", name: "Team A", value: 7 }]}
      format={(n) => `${n} sessions`}
      showTotal={false}
    />,
  );
  expect(screen.getByText("7 sessions")).toBeInTheDocument();
  expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
});

// The totals chart's stack carries every key on every group (so recharts has a
// rect to hang each label off), which would otherwise list a pile of zeroes.
test("StackedCostTooltip: hideEmpty drops zero/absent series, and the total ignores them", () => {
  render(
    <StackedCostTooltip
      active
      label="Alpha"
      payload={[
        { dataKey: "Team A", name: "Team A", value: 1000 },
        { dataKey: "Team B", name: "Team B", value: 0 },
        { dataKey: "Team C", name: "Team C" },
      ]}
      hideEmpty
    />,
  );
  expect(screen.getByText("Team A")).toBeInTheDocument();
  expect(screen.queryByText("Team B")).not.toBeInTheDocument();
  expect(screen.queryByText("Team C")).not.toBeInTheDocument();
  expect(screen.getAllByText("$10.00").length).toBe(2); // the surviving row, and the total
});

test("StackedCostTooltip: hideEmpty with nothing left renders nothing at all", () => {
  const { container } = render(<StackedCostTooltip active payload={[{ dataKey: "Team A", value: 0 }]} hideEmpty />);
  expect(container.firstChild).toBeNull();
});

// #30 item 7: dataKey is optional in recharts' own payload type; two rows
// both missing it used to share `key={undefined}`. Falling back to name/index
// keeps every row's key unique and each still renders.
test("StackedCostTooltip: rows with no dataKey at all still all render, keyed distinctly", () => {
  render(
    <StackedCostTooltip
      active
      payload={[
        { name: "Alpha", value: 1000 },
        { name: "Beta", value: 500 },
      ]}
    />,
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
});
