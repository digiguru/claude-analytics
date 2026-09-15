import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { ControlBar } from "./ControlBar.js";
import type { Status } from "../api.js";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    sync: vi.fn(),
    uploadCsv: vi.fn(),
    uploadProjects: vi.fn(),
  },
}));
vi.mock("../api.js", () => ({ api: apiMock }));

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

test("ControlBar: shows the current CSV/projects/cached-range pills", () => {
  render(
    <ControlBar
      status={status({ csvLoaded: true, csvSource: "attrs.csv", developerCount: 12 })}
      from="2026-01-01"
      to="2026-01-31"
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(screen.getByText(/CSV: attrs.csv/)).toBeInTheDocument();
  expect(screen.getByText(/Projects: none loaded/)).toBeInTheDocument();
  expect(screen.getByText(/Developers cached: 12/)).toBeInTheDocument();
});

test("ControlBar: no admin API key configured shows the warning banner", () => {
  render(
    <ControlBar
      status={status({ apiKeyConfigured: false })}
      from=""
      to=""
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(screen.getByText(/No Admin API key configured/)).toBeInTheDocument();
});

test("ControlBar: syncing without a from/to range reports an error and skips the API call", async () => {
  const onError = vi.fn();
  const user = userEvent.setup();
  render(
    <ControlBar
      status={status()}
      from=""
      to=""
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={vi.fn()}
      onError={onError}
    />,
  );
  await user.click(screen.getByText("Sync from API"));
  expect(onError).toHaveBeenCalledWith("Pick a from and to date to sync.");
  expect(apiMock.sync).not.toHaveBeenCalled();
});

test("ControlBar: a successful sync reports the synced counts and refreshes", async () => {
  apiMock.sync.mockResolvedValueOnce({
    effectiveRange: { from: "2026-01-01", to: "2026-01-02" },
    activityDays: 2,
    userProductRows: 5,
  });
  const onChanged = vi.fn();
  const onError = vi.fn();
  const user = userEvent.setup();
  render(
    <ControlBar
      status={status()}
      from="2026-01-01"
      to="2026-01-02"
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={onChanged}
      onError={onError}
    />,
  );
  await user.click(screen.getByText("Sync from API"));
  expect(await screen.findByText(/Synced 2 activity day\(s\), 5 user×product row\(s\)\./)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(null);
});

test("ControlBar: a sync with nothing to fetch reports that instead of counts", async () => {
  apiMock.sync.mockResolvedValueOnce({ effectiveRange: null, activityDays: 0, userProductRows: 0 });
  const user = userEvent.setup();
  render(
    <ControlBar
      status={status()}
      from="2026-01-01"
      to="2026-01-02"
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={vi.fn()}
      onError={vi.fn()}
    />,
  );
  await user.click(screen.getByText("Sync from API"));
  expect(await screen.findByText(/Nothing to sync/)).toBeInTheDocument();
});

test("ControlBar: a failed sync reports the error message", async () => {
  apiMock.sync.mockRejectedValueOnce(new Error("boom"));
  const onError = vi.fn();
  const user = userEvent.setup();
  render(
    <ControlBar
      status={status()}
      from="2026-01-01"
      to="2026-01-02"
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={vi.fn()}
      onError={onError}
    />,
  );
  await user.click(screen.getByText("Sync from API"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
});

test("ControlBar: uploading a CSV reports the row count and refreshes", async () => {
  apiMock.uploadCsv.mockResolvedValueOnce({ rows: 42 });
  const onChanged = vi.fn();
  const user = userEvent.setup();
  const { container } = render(
    <ControlBar
      status={status()}
      from=""
      to=""
      onFrom={vi.fn()}
      onTo={vi.fn()}
      onChanged={onChanged}
      onError={vi.fn()}
    />,
  );
  const input = container.querySelector('input[type="file"][accept=".csv,text/csv"]') as HTMLInputElement;
  const file = new File(["email,Role\na@x.com,Eng"], "attrs.csv", { type: "text/csv" });
  await user.upload(input, file);
  expect(await screen.findByText(/Loaded CSV: 42 row\(s\)\./)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});
