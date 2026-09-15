// Shared chart helpers.
import type { ComponentProps, ComponentType } from "react";
import { ReferenceArea } from "recharts";

/** recharts@3's ReferenceArea prop type resolves almost all SVG props (fill,
 *  stroke, even style) out of its public type, so cast once here rather than
 *  at every call site. */
export const RechartsReferenceArea = ReferenceArea as ComponentType<
  ComponentProps<typeof ReferenceArea> & Record<string, unknown>
>;

const TICK_FILL = "#9aa3b2";
const TICK_FONT = 11;
const LINE_HEIGHT = 12;

/** Greedily pack words into lines no longer than `maxChars`. Overflow past `maxLines`
 *  is folded into the last line and ellipsised so a label never grows unbounded. */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, Math.max(0, maxChars - 1))}…`;
  return kept;
}

/** Factory for a recharts <XAxis tick> that wraps long category labels onto multiple lines. */
function makeWrappedTick(maxChars: number, maxLines: number) {
  return function WrappedTick(props: { x?: number; y?: number; payload?: { value: unknown } }) {
    const { x = 0, y = 0, payload } = props;
    const lines = wrapLabel(String(payload?.value ?? ""), maxChars, maxLines);
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" fill={TICK_FILL} fontSize={TICK_FONT}>
          {lines.map((ln, i) => (
            <tspan key={i} x={0} dy={i === 0 ? LINE_HEIGHT : LINE_HEIGHT}>
              {ln}
            </tspan>
          ))}
        </text>
      </g>
    );
  };
}

/**
 * X-axis props that stay readable as the category count grows.
 *
 * - Short labels (e.g. dates): rotate to vertical past a handful of values.
 * - Long labels (default): wrap onto multiple horizontal lines and reserve height to fit.
 *
 * Spread the result onto a recharts <XAxis />.
 */
export function xAxisProps(
  count: number,
  maxLabelLen: number,
  opts: { rotateWhenShort?: boolean; forceAllTicks?: boolean } = {},
): Record<string, unknown> {
  if (count <= 6 && !opts.forceAllTicks) {
    // Few enough to lay flat; let recharts thin ticks if they collide.
    return { interval: "preserveStartEnd" as const };
  }
  // Short labels read fine rotated vertical — cheaper than wrapping.
  if (opts.rotateWhenShort && maxLabelLen <= 12) {
    const height = Math.min(120, 24 + maxLabelLen * 6);
    return { angle: -90, textAnchor: "end" as const, interval: 0, height, tickMargin: 8 };
  }
  // Long labels: wrap onto multiple lines so nothing is clipped.
  const maxChars = 16;
  const maxLines = 4;
  const height = LINE_HEIGHT * maxLines + 16;
  return {
    interval: 0,
    height,
    tick: makeWrappedTick(maxChars, maxLines),
  };
}

/** Shared categorical palette for charts with several series/groups (e.g. cost by
 *  product, cost by group). Colours repeat (via modulo) once a chart has more
 *  series than the palette has entries. */
export const COLORS = ["#d97757", "#5a6b8c", "#7fae7f", "#b08cc0", "#c0a96b", "#6b9bc0"];
/** Colour reserved for the "grey" bucket in stacked-by-group charts (e.g. Unassigned, Other). */
export const NEUTRAL_COLOR = "#5c6270";

// ---- Shared layout for charts that carry a CycleRail annotation strip below
// them. The rail is a plain CSS grid, not part of the recharts SVG, so it needs
// the plot's actual left/right gutters (margin + y-axis width) to line up its
// columns under the right bars. Charts that render a CycleRail should pass
// these as their <BarChart margin> and <YAxis width>.
export const CHART_MARGIN = { top: 5, right: 12, bottom: 5, left: 5 };
export const Y_AXIS_WIDTH = 50;
/** Left gutter to match with the rail's left padding. */
export const PLOT_LEFT = Y_AXIS_WIDTH + CHART_MARGIN.left;
/** Right gutter for a single-axis chart. Charts with a second (right-hand) axis
 *  should use PLOT_LEFT again instead. */
export const PLOT_RIGHT = CHART_MARGIN.right;
