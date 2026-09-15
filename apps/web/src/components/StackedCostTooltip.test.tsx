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
        { dataKey: "Alpha", name: "Alpha", value: 10, color: "#111" },
        { dataKey: "Beta", name: "Beta", value: 5, color: "#222" },
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
