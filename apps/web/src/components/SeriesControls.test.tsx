import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { SeriesControls } from "./SeriesControls.js";

test("SeriesControls: the active granularity button is marked active", () => {
  render(
    <SeriesControls
      granularity="week"
      onGranularity={vi.fn()}
      showTrend={false}
      onTrend={vi.fn()}
      showForecast={false}
      onForecast={vi.fn()}
    />,
  );
  expect(screen.getByText("Week")).toHaveClass("active");
  expect(screen.getByText("Day")).not.toHaveClass("active");
});

test("SeriesControls: clicking a granularity button reports it", async () => {
  const onGranularity = vi.fn();
  const user = userEvent.setup();
  render(
    <SeriesControls
      granularity="day"
      onGranularity={onGranularity}
      showTrend={false}
      onTrend={vi.fn()}
      showForecast={false}
      onForecast={vi.fn()}
    />,
  );
  await user.click(screen.getByText("Month"));
  expect(onGranularity).toHaveBeenCalledWith("month");
});

test("SeriesControls: toggling the trend/forecast checkboxes reports their new state", async () => {
  const onTrend = vi.fn();
  const onForecast = vi.fn();
  const user = userEvent.setup();
  render(
    <SeriesControls
      granularity="day"
      onGranularity={vi.fn()}
      showTrend={false}
      onTrend={onTrend}
      showForecast={false}
      onForecast={onForecast}
    />,
  );
  await user.click(screen.getByLabelText("Trend line"));
  expect(onTrend).toHaveBeenCalledWith(true);
  await user.click(screen.getByLabelText("Forecast"));
  expect(onForecast).toHaveBeenCalledWith(true);
});
