import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import { KeyBreakdownRows } from "./KeyBreakdownRows.js";

test("KeyBreakdownRows: a single key renders nothing (nothing to break down)", () => {
  const { container } = render(
    <KeyBreakdownRows keys={["Alpha"]} byKey={new Map([["Alpha", 10]])} colors={new Map([["Alpha", "#fff"]])} />,
  );
  expect(container.firstChild).toBeNull();
});

test("KeyBreakdownRows: renders one row per key present in byKey, in $ cents-to-dollars", () => {
  render(
    <KeyBreakdownRows
      keys={["Alpha", "Beta", "Gamma"]}
      byKey={
        new Map([
          ["Alpha", 1000],
          ["Beta", 500],
        ])
      }
      colors={
        new Map([
          ["Alpha", "#111"],
          ["Beta", "#222"],
          ["Gamma", "#333"],
        ])
      }
    />,
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("$10.00")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText("$5.00")).toBeInTheDocument();
  expect(screen.queryByText("Gamma")).not.toBeInTheDocument(); // no entry in byKey
});

test("KeyBreakdownRows: outerMuted swaps in the muted row class/style variant", () => {
  const { container } = render(
    <KeyBreakdownRows keys={["Alpha", "Beta"]} byKey={new Map([["Alpha", 1]])} colors={new Map()} outerMuted />,
  );
  expect(container.querySelector(".row.muted")).toBeInTheDocument();
});
