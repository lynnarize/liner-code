/*
  The arithmetic every Liner chart shares: linear scales, clean ticks, band positions,
  smooth paths that never overshoot, arcs, and compact numbers.
*/
export type Pt = { x: number; y: number };

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v: number) => r0 + (v - d0) * k;
  f.invert = (p: number) => (k ? d0 + (p - r0) / k : d0);
  return f as ((v: number) => number) & { invert: (p: number) => number };
}

/** Round, readable ticks covering min..max: 0 / 250 / 500, never 0 / 233 / 466. */
export function niceTicks(min: number, max: number, count = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, min: lo, max: hi };
}

/** Evenly spaced bands with a gap; returns each band's start and the band width. */
export function band(n: number, [r0, r1]: [number, number], gap = 0.3) {
  const step = (r1 - r0) / Math.max(1, n);
  const w = step * (1 - gap);
  return { at: (i: number) => r0 + i * step + (step - w) / 2, width: w, step };
}

/** Monotone cubic through the points: smooth, and it never bends past a data value. */
export function smoothPath(p: Pt[]) {
  if (p.length < 2) return p.length ? `M${p[0].x},${p[0].y}` : "";
  const n = p.length;
  const d = p.slice(1).map((q, i) => (q.y - p[i].y) / (q.x - p[i].x || 1));
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1].x - p[i].x) / 3;
    path += `C${p[i].x + h},${p[i].y + m[i] * h} ${p[i + 1].x - h},${p[i + 1].y - m[i + 1] * h} ${p[i + 1].x},${p[i + 1].y}`;
  }
  return path;
}

export const linePath = (p: Pt[]) => p.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join("");

/** An area under a line down to a baseline. */
export function areaPath(p: Pt[], y0: number, smooth = true) {
  if (!p.length) return "";
  const top = smooth ? smoothPath(p) : linePath(p);
  return `${top}L${p[p.length - 1].x},${y0}L${p[0].x},${y0}Z`;
}

/** A band between two lines (streams, ranges). */
export function ribbonPath(top: Pt[], bottom: Pt[]) {
  const back = [...bottom].reverse();
  return `${smoothPath(top)}L${back[0].x},${back[0].y}${smoothPath(back).replace(/^M[^C]*/, "")}Z`;
}

/** A ring segment from angle a0 to a1 (radians, 0 at 12 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  if (r0 <= 0) return `M${cx},${cy}L${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}Z`;
  return `M${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z`;
}

/** 1,284 / 12.9K / 4.2M. */
export function compact(n: number, digits = 1) {
  const a = Math.abs(n);
  if (a < 1000) return Number(n.toFixed(a < 10 && n % 1 ? digits : 0)).toLocaleString("en-US");
  const [d, s] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  return `${Number((n / d).toFixed(digits))}${s}`;
}

/** Index of the nearest x among sorted xs. */
export function nearest(xs: number[], x: number) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}
