/** SVG geometry for the liquid edges and stickers. Pure, so shapes are identical on server and client. */

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * A liquid surface: a sine wave at `baseline`, filled down to the bottom of the box. The box
 * holds a whole number of waves, so two copies side by side tile seamlessly when it drifts.
 */
export function wavePath({
  width,
  height,
  baseline,
  amplitude,
  waves,
  phase = 0,
  steps = 96,
}: {
  width: number;
  height: number;
  baseline: number;
  amplitude: number;
  waves: number;
  phase?: number;
  steps?: number;
}): string {
  const count = Math.max(8, Math.round(steps));
  const points: string[] = [];
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * width;
    const y = baseline + amplitude * Math.sin((i / count) * waves * Math.PI * 2 + phase);
    points.push(`${round(x)} ${round(y)}`);
  }
  return `M${points.join(" L")} L${width} ${height} L0 ${height} Z`;
}

/** Points of a starburst badge: `count` tips alternating between the outer and inner radius. */
export function starPoints(count: number, outer: number, inner: number, cx = 0, cy = 0): string {
  const tips = Math.max(3, Math.round(count));
  const points: string[] = [];
  for (let i = 0; i < tips * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / (tips * 2)) * Math.PI * 2 - Math.PI / 2;
    points.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
  }
  return points.join(" ");
}

/** A circle as a path starting at the top, clockwise: the track for text set on a ring. */
export function ringPath(cx: number, cy: number, radius: number): string {
  return `M${cx} ${cy - radius} a${radius} ${radius} 0 1 1 0 ${radius * 2} a${radius} ${radius} 0 1 1 0 ${-radius * 2}`;
}
