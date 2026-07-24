// Shared chart helpers.

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
  opts: { rotateWhenShort?: boolean } = {},
): Record<string, unknown> {
  if (count <= 6) {
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
