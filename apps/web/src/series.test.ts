import { test, expect } from "vitest";
import { bucketLabel, bucketSeries, prepareSeries } from "./series.js";

// ---- bucketLabel ----

test("bucketLabel: day granularity is the date itself", () => {
  expect(bucketLabel("2026-06-15", "day")).toBe("2026-06-15");
});

test("bucketLabel: month granularity truncates to YYYY-MM", () => {
  expect(bucketLabel("2026-06-15", "month")).toBe("2026-06");
});

test("bucketLabel: week granularity snaps to the Monday of that ISO week", () => {
  expect(bucketLabel("2026-06-17", "week")).toBe("2026-06-15"); // a Wednesday -> that week's Monday
  expect(bucketLabel("2026-06-15", "week")).toBe("2026-06-15"); // already a Monday
});

test("bucketLabel: a malformed date does not throw — falls back rather than crashing the chart (#30 item 4)", () => {
  expect(() => bucketLabel("not-a-date", "week")).not.toThrow();
  expect(bucketLabel("not-a-date", "week")).toBe("invalid-date");
});

// ---- bucketSeries ----

test("bucketSeries: day granularity passes rows through unchanged (shallow copies)", () => {
  const daily = [{ date: "2026-06-01", cost: 10 }];
  const out = bucketSeries(daily, "day", {});
  expect(out).toEqual(daily);
  expect(out[0]).not.toBe(daily[0]); // copy, not the same reference
});

test("bucketSeries: sums a metric across days in the same bucket by default", () => {
  const daily = [
    { date: "2026-06-01", cost: 10 },
    { date: "2026-06-02", cost: 20 },
  ];
  const out = bucketSeries(daily, "week", {});
  expect(out).toEqual([{ date: "2026-06-01", cost: 30 }]);
});

test("bucketSeries: a metric marked 'avg' is averaged (rounded) instead of summed", () => {
  const daily = [
    { date: "2026-06-01", dau: 10 },
    { date: "2026-06-02", dau: 3 },
  ];
  const out = bucketSeries(daily, "week", { dau: "avg" });
  expect(out).toEqual([{ date: "2026-06-01", dau: 7 }]); // (10+3)/2 = 6.5 -> rounds to 7
});

test("bucketSeries: non-numeric fields are dropped, not carried through as NaN", () => {
  const daily = [{ date: "2026-06-01", label: "x", cost: 5 }];
  const out = bucketSeries(daily, "week", {});
  expect(out).toEqual([{ date: "2026-06-01", cost: 5 }]);
});

// ---- prepareSeries ----

test("prepareSeries: with trend/forecast off, just buckets the data", () => {
  const daily = [
    { date: "2026-06-01", cost: 10 },
    { date: "2026-06-02", cost: 20 },
  ];
  const { data, forecastStart } = prepareSeries(daily, {
    granularity: "day",
    showTrend: false,
    showForecast: false,
    trendKey: "cost",
    aggs: {},
  });
  expect(data).toEqual(daily);
  expect(forecastStart).toBe(null);
});

test("prepareSeries: fewer than 2 buckets never computes a trend, even if requested", () => {
  const daily = [{ date: "2026-06-01", cost: 10 }];
  const { data, forecastStart } = prepareSeries(daily, {
    granularity: "day",
    showTrend: true,
    showForecast: true,
    trendKey: "cost",
    aggs: {},
  });
  expect(data[0]!.trend).toBeUndefined();
  expect(forecastStart).toBe(null);
});

test("prepareSeries: showTrend adds a trend value to every historical row", () => {
  const daily = [
    { date: "2026-06-01", cost: 10 },
    { date: "2026-06-02", cost: 20 },
    { date: "2026-06-03", cost: 30 },
  ];
  const { data } = prepareSeries(daily, {
    granularity: "day",
    showTrend: true,
    showForecast: false,
    trendKey: "cost",
    aggs: {},
  });
  expect(data.every((r) => typeof r.trend === "number")).toBe(true);
});

test("prepareSeries: showForecast appends future buckets carrying a Forecast key, and reports forecastStart", () => {
  const daily = [
    { date: "2026-06-01", cost: 10 },
    { date: "2026-06-02", cost: 20 },
  ];
  const { data, forecastStart } = prepareSeries(daily, {
    granularity: "day",
    showTrend: false,
    showForecast: true,
    trendKey: "cost",
    aggs: {},
  });
  expect(forecastStart).toBe("2026-06-03");
  const forecastRows = data.filter((r) => "costForecast" in r);
  expect(forecastRows.length).toBeGreaterThan(0);
  expect(data.length).toBeGreaterThan(daily.length);
});
