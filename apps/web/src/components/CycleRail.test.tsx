import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import { CycleRail } from "./CycleRail.js";

const labels = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];

test("CycleRail: renders nothing with no labels or no projects", () => {
  const { container: withoutLabels } = render(
    <CycleRail
      labels={[]}
      projects={[{ project: "P1", cycles: [{ name: "Discovery", start: "2026-01-01", end: null }] }]}
      granularity="day"
    />,
  );
  expect(withoutLabels.firstChild).toBeNull();

  const { container: withoutProjects } = render(<CycleRail labels={labels} projects={[]} granularity="day" />);
  expect(withoutProjects.firstChild).toBeNull();
});

test("CycleRail: renders a labelled lane per project with a chip per cycle in range", () => {
  render(
    <CycleRail
      labels={labels}
      projects={[
        { project: "Alpha", cycles: [{ name: "Discovery", start: "2026-01-01", end: "2026-01-02" }] },
        { project: "Beta", cycles: [{ name: "Build", start: "2026-01-03", end: null }] },
      ]}
      granularity="day"
    />,
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText("Discovery")).toBeInTheDocument();
  expect(screen.getByText("Build")).toBeInTheDocument();
});

test("CycleRail: caps lanes at 3 and reports the rest via moreCount", () => {
  const projects = ["A", "B", "C", "D"].map((project) => ({
    project,
    cycles: [{ name: "Cycle", start: "2026-01-01", end: null }],
  }));
  render(<CycleRail labels={labels} projects={projects} granularity="day" moreCount={1} />);
  expect(screen.getByText("A")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
  expect(screen.queryByText("D")).not.toBeInTheDocument();
  expect(screen.getByText("+1 more project(s) with cycles")).toBeInTheDocument();
});
