import { test, expect } from "vitest";
import {
  clipAroundAnchor,
  combineSummaries,
  dragSelectionReducer,
  initialDragSelectionState,
  liveIndexRanges,
  resolveRanges,
  summarizeRows,
  toIndexRange,
  type DragRegion,
  type IndexRange,
} from "./dragSelection.js";

const LABELS = ["a", "b", "c", "d", "e", "f", "g"];

// ---- toIndexRange ----

test("toIndexRange: resolves a region regardless of x1/x2 order", () => {
  expect(toIndexRange(LABELS, { x1: "c", x2: "a" })).toEqual({ lo: 0, hi: 2 });
});

test("toIndexRange: a label no longer in the chart (stale region) resolves to null", () => {
  expect(toIndexRange(LABELS, { x1: "a", x2: "nonexistent" })).toBe(null);
});

// ---- clipAroundAnchor ----

test("clipAroundAnchor: no existing regions — the full candidate range passes through", () => {
  expect(clipAroundAnchor(2, 4, [])).toEqual({ lo: 2, hi: 4 });
});

test("clipAroundAnchor: anchor inside an existing region returns null (nothing to add)", () => {
  const existing: IndexRange[] = [{ lo: 1, hi: 3 }];
  expect(clipAroundAnchor(2, 5, existing)).toBe(null);
});

test("clipAroundAnchor: truncates at the nearest region above the anchor", () => {
  const existing: IndexRange[] = [{ lo: 5, hi: 6 }];
  expect(clipAroundAnchor(2, 6, existing)).toEqual({ lo: 2, hi: 4 }); // clipped to just before index 5
});

test("clipAroundAnchor: truncates at the nearest region below the anchor", () => {
  const existing: IndexRange[] = [{ lo: 0, hi: 1 }];
  expect(clipAroundAnchor(4, 0, existing)).toEqual({ lo: 2, hi: 4 }); // clipped to just after index 1
});

test("clipAroundAnchor: clipped away to nothing (regions on both sides meet at the anchor) returns null", () => {
  const existing: IndexRange[] = [
    { lo: 0, hi: 2 },
    { lo: 2, hi: 4 },
  ];
  expect(clipAroundAnchor(2, 3, existing)).toBe(null); // anchor 2 is inside the first region
});

test("clipAroundAnchor: overlapping/adjacent existing regions on both sides squeeze the range to a single point", () => {
  const existing: IndexRange[] = [
    { lo: 0, hi: 1 },
    { lo: 4, hi: 6 },
  ];
  expect(clipAroundAnchor(2, 3, existing)).toEqual({ lo: 2, hi: 3 });
});

// ---- liveIndexRanges ----

test("liveIndexRanges: a reversed drag (end before start) normalizes lo <= hi", () => {
  const ranges = liveIndexRanges(LABELS, [], { start: "e", end: "b", add: false });
  expect(ranges).toEqual([{ lo: 1, hi: 4 }]);
});

test("liveIndexRanges: a single-cell drag produces a one-wide range", () => {
  const ranges = liveIndexRanges(LABELS, [], { start: "c", end: "c", add: false });
  expect(ranges).toEqual([{ lo: 2, hi: 2 }]);
});

test("liveIndexRanges: replace mode (no shift) discards committed regions entirely", () => {
  const committed: DragRegion[] = [{ x1: "a", x2: "b" }];
  const ranges = liveIndexRanges(LABELS, committed, { start: "d", end: "e", add: false });
  expect(ranges).toEqual([{ lo: 3, hi: 4 }]);
});

test("liveIndexRanges: additive mode keeps committed regions and adds the clipped new one", () => {
  const committed: DragRegion[] = [{ x1: "a", x2: "a" }];
  const ranges = liveIndexRanges(LABELS, committed, { start: "c", end: "f", add: true });
  expect(ranges).toEqual([
    { lo: 0, hi: 0 },
    { lo: 2, hi: 5 },
  ]);
});

test("liveIndexRanges: additive drag clipped away to nothing adds no region", () => {
  const committed: DragRegion[] = [{ x1: "b", x2: "d" }];
  const ranges = liveIndexRanges(LABELS, committed, { start: "c", end: "c", add: true });
  expect(ranges).toEqual([{ lo: 1, hi: 3 }]); // anchor inside committed region -> nothing added
});

test("liveIndexRanges: with no activeDrag, returns just the committed regions", () => {
  const committed: DragRegion[] = [{ x1: "a", x2: "b" }];
  expect(liveIndexRanges(LABELS, committed, null)).toEqual([{ lo: 0, hi: 1 }]);
});

// ---- resolveRanges ----

test("resolveRanges: converts index ranges back to label pairs", () => {
  expect(resolveRanges(LABELS, [{ lo: 1, hi: 3 }])).toEqual([{ x1: "b", x2: "d" }]);
});

// ---- summarizeRows / combineSummaries ----

test("summarizeRows: sums numeric keys across rows, ignoring non-numeric/zero", () => {
  const rows = [
    { date: "a", chat: 10, cc: 0 },
    { date: "b", chat: 5, cc: 2 },
  ];
  const { total, byKey } = summarizeRows(rows, ["chat", "cc"]);
  expect(total).toBe(17);
  expect(byKey.get("chat")).toBe(15);
  expect(byKey.has("cc")).toBe(true); // cc:2 present even though the first row's cc:0 wasn't recorded
});

test("combineSummaries: null when there's nothing to combine", () => {
  expect(combineSummaries([])).toBe(null);
});

test("combineSummaries: sums totals and merges per-key maps across regions", () => {
  const a = { total: 10, byKey: new Map([["chat", 10]]) };
  const b = {
    total: 5,
    byKey: new Map([
      ["chat", 3],
      ["cc", 2],
    ]),
  };
  const combined = combineSummaries([a, b]);
  expect(combined!.total).toBe(15);
  expect(combined!.byKey.get("chat")).toBe(13);
  expect(combined!.byKey.get("cc")).toBe(2);
});

// ---- dragSelectionReducer (#23 item 1: the nested-setState bug this replaces) ----

test("dragSelectionReducer: start begins a replace-mode drag", () => {
  const s = dragSelectionReducer(initialDragSelectionState, { type: "start", label: "b", add: false });
  expect(s.activeDrag).toEqual({ start: "b", end: "b", add: false });
});

test("dragSelectionReducer: move extends the active drag's end", () => {
  const started = dragSelectionReducer(initialDragSelectionState, { type: "start", label: "b", add: false });
  const moved = dragSelectionReducer(started, { type: "move", label: "d" });
  expect(moved.activeDrag).toEqual({ start: "b", end: "d", add: false });
});

test("dragSelectionReducer: move with no active drag is a no-op", () => {
  expect(dragSelectionReducer(initialDragSelectionState, { type: "move", label: "d" })).toBe(initialDragSelectionState);
});

test("dragSelectionReducer: commit in replace mode sets regions to exactly the dragged range", () => {
  let s = dragSelectionReducer(initialDragSelectionState, { type: "start", label: "b", add: false });
  s = dragSelectionReducer(s, { type: "move", label: "d" });
  s = dragSelectionReducer(s, { type: "commit", labels: LABELS });
  expect(s.activeDrag).toBe(null);
  expect(s.regions).toEqual([{ x1: "b", x2: "d" }]);
});

test("dragSelectionReducer: commit with add=true appends a clipped region alongside existing ones (#23's add-region path)", () => {
  const withOne: import("./dragSelection.js").DragSelectionState = {
    regions: [{ x1: "a", x2: "a" }],
    activeDrag: { start: "c", end: "f", add: true },
  };
  const committed = dragSelectionReducer(withOne, { type: "commit", labels: LABELS });
  expect(committed.activeDrag).toBe(null);
  expect(committed.regions).toEqual([
    { x1: "a", x2: "a" },
    { x1: "c", x2: "f" },
  ]);
});

test("dragSelectionReducer: calling the reducer twice with the same (state, action) is idempotent — the StrictMode double-invoke case for #23", () => {
  const withOne: import("./dragSelection.js").DragSelectionState = {
    regions: [{ x1: "a", x2: "a" }],
    activeDrag: { start: "c", end: "f", add: true },
  };
  const action = { type: "commit" as const, labels: LABELS };
  const first = dragSelectionReducer(withOne, action);
  const second = dragSelectionReducer(withOne, action); // React StrictMode invokes the reducer twice with the SAME prior state
  expect(second).toEqual(first); // must produce the identical result, not a doubled region
});

test("dragSelectionReducer: commit with nothing to add (anchor inside an existing region) discards the drag without adding a region", () => {
  const withOne: import("./dragSelection.js").DragSelectionState = {
    regions: [{ x1: "b", x2: "d" }],
    activeDrag: { start: "c", end: "c", add: true },
  };
  const committed = dragSelectionReducer(withOne, { type: "commit", labels: LABELS });
  expect(committed.regions).toEqual([{ x1: "b", x2: "d" }]);
  expect(committed.activeDrag).toBe(null);
});

test("dragSelectionReducer: commit with no active drag is a no-op", () => {
  expect(dragSelectionReducer(initialDragSelectionState, { type: "commit", labels: LABELS })).toBe(
    initialDragSelectionState,
  );
});

test("dragSelectionReducer: remove drops the region at the given index", () => {
  const state = {
    regions: [
      { x1: "a", x2: "a" },
      { x1: "c", x2: "c" },
    ],
    activeDrag: null,
  };
  expect(dragSelectionReducer(state, { type: "remove", index: 0 }).regions).toEqual([{ x1: "c", x2: "c" }]);
});

test("dragSelectionReducer: clear and reset both return to the initial empty state", () => {
  const state = { regions: [{ x1: "a", x2: "a" }], activeDrag: { start: "b", end: "c", add: false } };
  expect(dragSelectionReducer(state, { type: "clear" })).toEqual(initialDragSelectionState);
  expect(dragSelectionReducer(state, { type: "reset" })).toEqual(initialDragSelectionState);
});
