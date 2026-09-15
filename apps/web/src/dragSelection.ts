// Pure index arithmetic for the Groups page's click-and-drag range selection
// over the "Cost over time" chart. Extracted from GroupsView.tsx (#36) so it's
// testable with no component/rendering involved, and driven via a reducer
// (dragSelectionReducer) rather than the previous setState-inside-setState
// pattern — see #23 item 1: that nested-setState commit only survived because
// clipAroundAnchor happened to return null on a StrictMode-doubled second
// call, which was accidental, not designed. A reducer computes its result
// atomically from a single state snapshot with no nested dispatches, so
// React's StrictMode double-invoke of the reducer is harmless by construction
// (same state + action always yields the same result; the extra call is
// simply discarded).

/** One committed selection, in chart-label space (never overlaps another). */
export interface DragRegion {
  x1: string;
  x2: string;
}

/** The same selection in index space, resolved against the chart's current labels. */
export interface IndexRange {
  lo: number;
  hi: number;
}

/** An in-progress drag: the anchor point it started on, its current end, and
 *  whether it's additive (Shift held) or a plain replace. */
export interface ActiveDrag {
  start: string;
  end: string;
  add: boolean;
}

export interface DragSelectionState {
  regions: DragRegion[];
  activeDrag: ActiveDrag | null;
}

export const initialDragSelectionState: DragSelectionState = { regions: [], activeDrag: null };

/** Resolve a label-space region to index space against the chart's current
 *  labels, or null if either label no longer exists (e.g. the data changed
 *  out from under a stale region). */
export function toIndexRange(labels: string[], r: DragRegion): IndexRange | null {
  const i1 = labels.indexOf(r.x1);
  const i2 = labels.indexOf(r.x2);
  if (i1 === -1 || i2 === -1) return null;
  return { lo: Math.min(i1, i2), hi: Math.max(i1, i2) };
}

/**
 * Regions never overlap. Clip a candidate additive range to the free run of
 * indices reachable from `anchor` (the index the drag/click started on) —
 * truncating at the nearest already-selected region on either side. Returns
 * null when the anchor itself sits inside an existing region (nothing to add)
 * or the whole range gets clipped away.
 */
export function clipAroundAnchor(anchor: number, other: number, existing: IndexRange[]): IndexRange | null {
  if (existing.some((r) => anchor >= r.lo && anchor <= r.hi)) return null;
  let lo = Math.min(anchor, other);
  let hi = Math.max(anchor, other);
  for (const r of existing) {
    if (r.hi < anchor) lo = Math.max(lo, r.hi + 1);
    if (r.lo > anchor) hi = Math.min(hi, r.lo - 1);
  }
  return lo <= hi ? { lo, hi } : null;
}

/**
 * Committed regions plus the in-progress drag (already clipped so the live
 * preview never overlaps a committed region), as index ranges — the pure
 * core of "what's currently selected", independent of chart row data.
 */
export function liveIndexRanges(labels: string[], regions: DragRegion[], activeDrag: ActiveDrag | null): IndexRange[] {
  const committed = regions.map((r) => toIndexRange(labels, r)).filter((r): r is IndexRange => r !== null);
  const ranges = [...committed];
  if (activeDrag) {
    const startIdx = labels.indexOf(activeDrag.start);
    const endIdx = labels.indexOf(activeDrag.end);
    if (startIdx !== -1 && endIdx !== -1) {
      if (activeDrag.add) {
        const clipped = clipAroundAnchor(startIdx, endIdx, committed);
        if (clipped) ranges.push(clipped);
      } else {
        // Replace mode: the drag isn't constrained by regions it's about to wipe out.
        ranges.length = 0;
        ranges.push({ lo: Math.min(startIdx, endIdx), hi: Math.max(startIdx, endIdx) });
      }
    }
  }
  return ranges;
}

/** Resolve index ranges back to label pairs, for rendering/summarizing. */
export function resolveRanges(labels: string[], ranges: IndexRange[]): DragRegion[] {
  return ranges.map((r) => ({ x1: labels[r.lo]!, x2: labels[r.hi]! }));
}

/** Sum a set of rows' stacked series keys into a total + per-key breakdown. */
export function summarizeRows(
  rows: Record<string, unknown>[],
  keys: string[],
): { total: number; byKey: Map<string, number> } {
  const byKey = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    for (const key of keys) {
      const v = Number(row[key]) || 0;
      if (v) byKey.set(key, (byKey.get(key) ?? 0) + v);
      total += v;
    }
  }
  return { total, byKey };
}

/** Sum multiple region summaries into one combined total + breakdown, or null
 *  when there are none (nothing selected). */
export function combineSummaries(
  summaries: { total: number; byKey: Map<string, number> }[],
): { total: number; byKey: Map<string, number> } | null {
  if (summaries.length === 0) return null;
  const byKey = new Map<string, number>();
  let total = 0;
  for (const s of summaries) {
    total += s.total;
    for (const [k, v] of s.byKey) byKey.set(k, (byKey.get(k) ?? 0) + v);
  }
  return { total, byKey };
}

export type DragAction =
  | { type: "start"; label: string; add: boolean }
  | { type: "move"; label: string }
  | { type: "commit"; labels: string[] }
  | { type: "remove"; index: number }
  | { type: "clear" }
  | { type: "reset" };

/**
 * Pure reducer for the drag-selection state machine — see the module comment
 * for why this (rather than nested setState calls) is the fix for #23's
 * item 1. `commit` needs the chart's current labels to convert the
 * in-progress drag's start/end back to indices, so it's carried on the
 * action rather than closed over.
 */
export function dragSelectionReducer(state: DragSelectionState, action: DragAction): DragSelectionState {
  switch (action.type) {
    case "start":
      return { ...state, activeDrag: { start: action.label, end: action.label, add: action.add } };
    case "move":
      if (!state.activeDrag) return state;
      return { ...state, activeDrag: { ...state.activeDrag, end: action.label } };
    case "commit": {
      const cur = state.activeDrag;
      if (!cur) return state;
      const { labels } = action;
      const startIdx = labels.indexOf(cur.start);
      const endIdx = labels.indexOf(cur.end);
      if (startIdx === -1 || endIdx === -1) return { ...state, activeDrag: null };
      if (!cur.add) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        return { activeDrag: null, regions: [{ x1: labels[lo]!, x2: labels[hi]! }] };
      }
      const existing = state.regions.map((r) => toIndexRange(labels, r)).filter((r): r is IndexRange => r !== null);
      const clipped = clipAroundAnchor(startIdx, endIdx, existing);
      if (!clipped) return { ...state, activeDrag: null };
      return { activeDrag: null, regions: [...state.regions, { x1: labels[clipped.lo]!, x2: labels[clipped.hi]! }] };
    }
    case "remove":
      return { ...state, regions: state.regions.filter((_, i) => i !== action.index) };
    case "clear":
    case "reset":
      return initialDragSelectionState;
    default:
      return state;
  }
}
