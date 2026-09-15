import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { GroupsControls } from "./GroupsControls.js";

// GroupsControls' <label>/<select> pairs are adjacent siblings, not
// htmlFor/id-associated, so getByLabelText can't find them — look up each
// select via the sibling label's parent instead.
function selectNear(labelText: string) {
  return within(screen.getByText(labelText).parentElement!).getByRole("combobox");
}

test("GroupsControls: no CSV or projects file loaded shows the placeholder option", () => {
  render(
    <GroupsControls
      dimension=""
      onDimensionChange={vi.fn()}
      dimensions={[]}
      timelineDimensions={[]}
      cycleAvailable={false}
      quickFilterFacets={[]}
      qfRaw=""
      onQfChange={vi.fn()}
      product=""
      onProductChange={vi.fn()}
      from=""
      to=""
      effectiveFilterQuery={undefined}
      scopeValue={undefined}
      scopeDimension={undefined}
    />,
  );
  expect(screen.getByText("— no CSV or projects file loaded —")).toBeInTheDocument();
  expect(screen.queryByText("Quick filter by")).not.toBeInTheDocument();
});

test("GroupsControls: lists timeline + CSV dimensions, and Cycle only when available", () => {
  render(
    <GroupsControls
      dimension="@project"
      onDimensionChange={vi.fn()}
      dimensions={["Role"]}
      timelineDimensions={[{ id: "@project", label: "Project" }]}
      cycleAvailable
      quickFilterFacets={[]}
      qfRaw=""
      onQfChange={vi.fn()}
      product=""
      onProductChange={vi.fn()}
      from=""
      to=""
      effectiveFilterQuery={undefined}
      scopeValue={undefined}
      scopeDimension={undefined}
    />,
  );
  expect(screen.getByRole("option", { name: "Project" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Role" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Cycle" })).toBeInTheDocument();
});

test("GroupsControls: changing Stacking by / Quick filter by / Product reports the new value", async () => {
  const onDimensionChange = vi.fn();
  const onQfChange = vi.fn();
  const onProductChange = vi.fn();
  const user = userEvent.setup();
  render(
    <GroupsControls
      dimension="@project"
      onDimensionChange={onDimensionChange}
      dimensions={["Role"]}
      timelineDimensions={[{ id: "@project", label: "Project" }]}
      cycleAvailable={false}
      quickFilterFacets={[{ id: "@project", label: "Project", values: ["Alpha"], kind: "timeline" }]}
      qfRaw=""
      onQfChange={onQfChange}
      product=""
      onProductChange={onProductChange}
      from=""
      to=""
      effectiveFilterQuery={undefined}
      scopeValue={undefined}
      scopeDimension={undefined}
    />,
  );
  await user.selectOptions(selectNear("Stacking by"), "Role");
  expect(onDimensionChange).toHaveBeenCalledWith("Role");
  await user.selectOptions(selectNear("Quick filter by"), "@project::Alpha");
  expect(onQfChange).toHaveBeenCalledWith("@project::Alpha");
  await user.selectOptions(selectNear("Product (cost/tokens)"), "chat");
  expect(onProductChange).toHaveBeenCalledWith("chat");
});

test("GroupsControls: renders the two export links", () => {
  render(
    <GroupsControls
      dimension="@project"
      onDimensionChange={vi.fn()}
      dimensions={[]}
      timelineDimensions={[{ id: "@project", label: "Project" }]}
      cycleAvailable={false}
      quickFilterFacets={[]}
      qfRaw=""
      onQfChange={vi.fn()}
      product=""
      onProductChange={vi.fn()}
      from=""
      to=""
      effectiveFilterQuery={undefined}
      scopeValue={undefined}
      scopeDimension={undefined}
    />,
  );
  expect(screen.getByText("Export CSV").closest("a")).toHaveAttribute("href", expect.stringContaining("/api/export"));
  expect(screen.getByText("Export daily CSV").closest("a")).toHaveAttribute(
    "href",
    expect.stringContaining("/api/export/groups-daily"),
  );
});
