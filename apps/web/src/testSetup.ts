// Shared Vitest setup for apps/web's component tests (#38). Loaded via
// vitest.config.ts's `web` project `setupFiles`, so it applies to every test
// in that project — including the vi.mock below, which Vitest hoists for
// whichever file pulls in "recharts" through any import chain.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { cloneElement, createElement, isValidElement, type ReactNode } from "react";

// This project doesn't set `test.globals: true`, so @testing-library/react's
// own auto-cleanup (which hooks into the test framework's global afterEach)
// never registers — without this, each render() in a file leaves its DOM
// tree mounted for the next test, and queries start matching duplicates.
afterEach(() => cleanup());

// jsdom has no ResizeObserver, and recharts' <ResponsiveContainer> uses one to
// measure its box — reporting 0×0 in jsdom, so it renders nothing. Replacing
// only ResponsiveContainer with a fixed-size div (leaving the rest of
// recharts real) is the reliable fix; stubbing ResizeObserver/
// getBoundingClientRect directly is more brittle across recharts releases.
// See #38.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    // recharts' real ResponsiveContainer clones its child with the measured
    // width/height as props — the chart itself needs those to render an SVG
    // at all, not just a sized container div, so this mock does the same.
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      createElement(
        "div",
        { style: { width: 800, height: 400 } },
        isValidElement(children) ? cloneElement(children, { width: 800, height: 400 } as object) : children,
      ),
  };
});
