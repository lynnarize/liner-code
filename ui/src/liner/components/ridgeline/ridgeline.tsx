/*
  Liner · Ridgeline
  How a distribution shifts across an ordered sequence, like months. Each row is a smooth
  ridge over one shared axis, overlapping the one above a little. The rows are ordered, so
  they take the accent's steps in order; a sliver of surface keeps each ridge distinct.
*/
import { useMemo, useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, type ChartFrameProps } from "../chart/chart";
import { linear, smoothPath } from "../chart/scale";
import { STEPS } from "../chart/palette";

export type Ridge = { label: string; values: number[] };
export type RidgelineProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  ridges: Ridge[];
  domain: [number, number];
  unit?: string;
  rowHeight?: number;
};

/** A smooth density estimate (Gaussian kernel) over the domain. */
function density(values: number[], [lo, hi]: [number, number], steps = 48) {
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - values.reduce((s, x) => s + x, 0) / values.length) ** 2, 0) / values.length) || 1;
  const bw = 1.06 * sd * values.length ** -0.2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / steps;
    const y = values.reduce((a, v) => a + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0) / (values.length * bw * Math.sqrt(2 * Math.PI));
    return { x, y };
  });
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function Ridgeline({ ridges, domain, unit = "", rowHeight = 30, ...frame }: RidgelineProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hot, setHot] = useState<number | null>(null);
  const w = size?.width ?? 0;
  const lab = 56;
  const height = ridges.length * rowHeight + rowHeight * 1.6 + 20;
  const curves = useMemo(() => ridges.map((r) => density(r.values, domain)), [ridges, domain]);
  const peak = Math.max(...curves.flat().map((p) => p.y));
  const x = linear(domain, [lab, w - 8]);
  const amp = rowHeight * 2.2;
  // Ordered rows take the accent's steps in order, light to dark.
  const color = (i: number) => STEPS[Math.round((i / Math.max(1, ridges.length - 1)) * (STEPS.length - 1))];
  const ticks = Array.from({ length: 5 }, (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / 4);

  return (
    <ChartFrame {...frame} table={{ columns: ["", "Median", "Low", "High"], rows: ridges.map((r) => [r.label, `${median(r.values)}${unit}`, `${Math.min(...r.values)}${unit}`, `${Math.max(...r.values)}${unit}`]) }}>
      <div ref={ref} className="l-viz-hit" style={{ height }} role="img" aria-label={`${frame.title}: ${ridges.map((r) => `${r.label} median ${median(r.values)}${unit}`).join(", ")}`} onPointerLeave={() => setHot(null)}>
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            {ticks.map((t) => (
              <g key={t} className="l-viz__grid">
                <line x1={x(t)} x2={x(t)} y1={6} y2={height - 18} />
                <text x={x(t)} y={height - 4} textAnchor="middle">
                  {Math.round(t)}
                  {unit}
                </text>
              </g>
            ))}
            {curves.map((c, i) => {
              const base = rowHeight * 1.6 + i * rowHeight;
              const pts = c.map((p) => ({ x: x(p.x), y: base - (p.y / peak) * amp }));
              const top = smoothPath(pts);
              const mx = x(median(ridges[i].values));
              return (
                <g key={ridges[i].label} onPointerEnter={() => setHot(i)} className="l-viz-mark l-viz-fade" style={{ animationDelay: `${i * 50}ms`, opacity: hot !== null && hot !== i ? 0.45 : 1 }}>
                  <path d={`${top}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z`} fill={color(i)} stroke="var(--l-card-fill)" strokeWidth={2} />
                  <line x1={mx} x2={mx} y1={base} y2={base - 6} stroke="var(--l-card-fill)" strokeWidth={2} />
                  <text className="l-viz-label" x={lab - 10} y={base - 4} textAnchor="end">
                    {ridges[i].label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hot !== null && w > 0 && (
          <ChartTip
            x={x(median(ridges[hot].values))}
            y={rowHeight * 1.6 + hot * rowHeight - 20}
            width={w}
            title={ridges[hot].label}
            rows={[
              { label: "median", value: `${median(ridges[hot].values)}${unit}`, color: color(hot), kind: "rect" },
              { label: "range", value: `${Math.min(...ridges[hot].values)}–${Math.max(...ridges[hot].values)}${unit}` },
            ]}
          />
        )}
      </div>
    </ChartFrame>
  );
}
