import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { FilterMenu } from "./FilterMenu.js";
import { EMPTY_FILTER, type FilterSpec } from "../filters.js";
import type { UserListEntry } from "../api.js";

const { apiMock } = vi.hoisted(() => ({ apiMock: { users: vi.fn() } }));
vi.mock("../api.js", () => ({ api: apiMock }));

function user(email: string, role: string): UserListEntry {
  return { email, attributes: { Role: role } };
}

beforeEach(() => {
  localStorage.clear();
  apiMock.users.mockReset();
  apiMock.users.mockResolvedValue({ users: [user("a@x.com", "Engineer"), user("b@x.com", "Manager")] });
});

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Filters/ }));
  return user;
}

test("FilterMenu: fetches the member list ranged by from/to", () => {
  render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from="2026-01-01"
      to="2026-01-31"
      filter={EMPTY_FILTER}
      onChange={vi.fn()}
    />,
  );
  expect(apiMock.users).toHaveBeenCalledWith("2026-01-01", "2026-01-31");
});

test("FilterMenu: shows a hidden-count badge and lists a facet's values once expanded", async () => {
  render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={{ hidden: { Role: ["Manager"] } }}
      onChange={vi.fn()}
    />,
  );
  const user = await openMenu();
  expect(screen.getByText(/1 hidden/)).toBeInTheDocument();

  await user.click(await screen.findByRole("button", { name: /Role/ }));
  expect(screen.getByText("Engineer")).toBeInTheDocument();
  expect(screen.getByText("Manager")).toBeInTheDocument();
});

test("FilterMenu: toggling a facet value's checkbox reports a new filter spec", async () => {
  const onChange = vi.fn();
  render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={EMPTY_FILTER}
      onChange={onChange}
    />,
  );
  const user = await openMenu();
  await user.click(await screen.findByRole("button", { name: /Role/ }));
  await user.click(screen.getByLabelText("Manager"));
  expect(onChange).toHaveBeenCalledWith({ hidden: { Role: ["Manager"] } });
});

test("FilterMenu: Select none hides every value in the facet", async () => {
  const onChange = vi.fn();
  render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={EMPTY_FILTER}
      onChange={onChange}
    />,
  );
  const user = await openMenu();
  await user.click(await screen.findByRole("button", { name: /Role/ }));
  await user.click(screen.getByText("Select none"));
  expect(onChange).toHaveBeenCalledWith({ hidden: { Role: ["Engineer", "Manager"] } });
});

test("FilterMenu: Clear all is disabled with an empty filter, enabled once something's hidden", async () => {
  render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={{ hidden: { Role: ["Manager"] } }}
      onChange={vi.fn()}
    />,
  );
  await openMenu();
  expect(screen.getByText("Clear all")).toBeEnabled();
});

test("FilterMenu: saving the current filter under a name persists it and can reload it", async () => {
  const filter: FilterSpec = { hidden: { Role: ["Manager"] } };
  const onChange = vi.fn();
  const { rerender } = render(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={filter}
      onChange={onChange}
    />,
  );
  const user = await openMenu();
  await user.type(screen.getByPlaceholderText("Name this filter set…"), "Engineers only");
  await user.click(screen.getByText("Save"));

  const savedRow = within(screen.getByText("Engineers only").closest(".filter-saved-row")!);
  expect(savedRow.getByText("Engineers only")).toBeInTheDocument();

  // Reflects as "active" once the parent's filter matches what was saved.
  rerender(
    <FilterMenu
      dimensions={["Role"]}
      timelineDimensions={[]}
      csvLoaded
      from=""
      to=""
      filter={filter}
      onChange={onChange}
    />,
  );
  expect(screen.getByText("Engineers only")).toHaveClass("active");

  await user.click(screen.getByTitle("Delete"));
  expect(screen.queryByText("Engineers only")).not.toBeInTheDocument();
});

test("FilterMenu: no CSV loaded shows the upload hint", async () => {
  render(
    <FilterMenu
      dimensions={[]}
      timelineDimensions={[]}
      csvLoaded={false}
      from=""
      to=""
      filter={EMPTY_FILTER}
      onChange={vi.fn()}
    />,
  );
  await openMenu();
  expect(screen.getByText(/Upload a CSV to filter by attributes/)).toBeInTheDocument();
});
