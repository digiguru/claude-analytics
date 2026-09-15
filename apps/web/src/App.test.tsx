import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { App } from "./App.js";
import type { Status } from "./api.js";

// App's own logic (status fetch, tab routing, error/filter banners, URL
// sync) is what's under test — the view/control components it wires
// together are each tested independently (or, for the chart-heavy views,
// intentionally left to the Playwright smoke test), so they're stubbed here
// to keep this test about App itself, not a rendering of the whole page.
vi.mock("./components/ControlBar.js", () => ({
  ControlBar: (props: { from: string; to: string; children?: React.ReactNode }) => (
    <div data-testid="control-bar" data-from={props.from} data-to={props.to}>
      {props.children}
    </div>
  ),
}));
vi.mock("./components/FilterMenu.js", () => ({ FilterMenu: () => <div data-testid="filter-menu" /> }));
vi.mock("./components/OverviewView.js", () => ({ OverviewView: () => <div data-testid="overview-view" /> }));
vi.mock("./components/GroupsView.js", () => ({ GroupsView: () => <div data-testid="groups-view" /> }));
vi.mock("./components/MembersView.js", () => ({ MembersView: () => <div data-testid="members-view" /> }));

const { apiMock } = vi.hoisted(() => ({ apiMock: { status: vi.fn() } }));
vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>();
  return { ...actual, api: apiMock };
});

function status(overrides: Partial<Status> = {}): Status {
  return {
    csvLoaded: false,
    csvSource: null,
    csvRows: 0,
    dimensions: [],
    projectsLoaded: false,
    projectsSource: null,
    projectCount: 0,
    projectWarnings: [],
    timelineDimensions: [],
    projectCycles: [],
    cycleCount: 0,
    cachedDateRange: null,
    developerCount: 0,
    apiKeyConfigured: true,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  apiMock.status.mockReset();
  apiMock.status.mockResolvedValue(status());
});

test("App: defaults to the Overview tab and fetches status on mount", async () => {
  render(<App />);
  expect(await screen.findByTestId("overview-view")).toBeInTheDocument();
  expect(apiMock.status).toHaveBeenCalledTimes(1);
});

test("App: switching tabs renders the matching view, one at a time", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("overview-view");

  await user.click(screen.getByText("Groups & products"));
  expect(await screen.findByTestId("groups-view")).toBeInTheDocument();
  expect(screen.queryByTestId("overview-view")).not.toBeInTheDocument();

  await user.click(screen.getByText("Members"));
  expect(await screen.findByTestId("members-view")).toBeInTheDocument();
  expect(screen.queryByTestId("groups-view")).not.toBeInTheDocument();
});

test("App: a failed status fetch shows the error banner", async () => {
  apiMock.status.mockRejectedValueOnce(new Error("network down"));
  render(<App />);
  expect(await screen.findByText("network down")).toBeInTheDocument();
});

test("App: fills from/to from the cached date range once status loads, unless the URL already pins them", async () => {
  apiMock.status.mockResolvedValueOnce(status({ cachedDateRange: { min: "2026-01-01", max: "2026-02-01" } }));
  render(<App />);
  await screen.findByTestId("overview-view");
  expect(screen.getByTestId("control-bar")).toHaveAttribute("data-from", "2026-01-01");
  expect(screen.getByTestId("control-bar")).toHaveAttribute("data-to", "2026-02-01");
});

test("App: a filter already active in localStorage shows the hidden-count banner", async () => {
  localStorage.setItem("claude-analytics:active-filter", JSON.stringify({ hidden: { Role: ["Manager"] } }));
  render(<App />);
  await screen.findByTestId("overview-view");
  expect(screen.getByText(/1 value\(s\) hidden/)).toBeInTheDocument();
});
