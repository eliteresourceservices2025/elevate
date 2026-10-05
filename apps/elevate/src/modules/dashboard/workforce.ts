/**
 * SVG points ("x,y x,y ...") for a small trend line in a 120 x 36 box. Hidden months (null) are skipped, so the line only joins
 * what is visible. Needs two visible points to draw anything.
 */
export function sparkline(values: (number | null)[], width = 120, height = 36, pad = 3): string | null {
  const visible = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (visible.length < 2) return null;
  const min = Math.min(...visible.map((p) => p.v));
  const max = Math.max(...visible.map((p) => p.v));
  const span = max - min || 1;
  const steps = Math.max(values.length - 1, 1);
  return visible
    .map(({ v, i }) => {
      const x = pad + (i / steps) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
