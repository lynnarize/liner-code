/*
  Liner · Slope chart
  Before and after, item by item. Each line runs from its old value to its new one, so what
  rose and what fell is a matter of slant. The item you point at (or name) takes the accent;
  the rest stay grey, labelled at both ends.
*/
import { useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { compact, linear } from "../chart/scale";

export type SlopeItem = { label: string; before: number; after: number };
export type SlopeChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  items: SlopeItem[];
  labels?: [string, string];
  focus?: string;
  height?: number;
  format?: (v: number) => string;
};

export function SlopeChart({ items, labels = ["Before", "After"], focus, height = 240, format = compact, ...frame }: SlopeChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hot, setHot] = useState<string | null>(null);
  const lit = hot ?? focus ?? null;
  const w = size?.width ?? 0;
  const vals = items.flatMap((i) => [i.before, i.after]);
  const y = linear([Math.min(...vals), Math.max(...vals)], [height - 14, 26]);
  const x0 = Math.min(150, w * 0.32);
  const x1 = w - Math.min(150, w * 0.32);
  const order = [...items].sort((a, b) => (a.label === lit ? 1 : 0) - (b.label === lit ? 1 : 0));
  return (
    <ChartFrame {...frame} table={{ columns: ["", labels[0], labels[1], "Change"], rows: items.map((i) => [i.label, i.before, i.after, `${i.after >= i.before ? "+" : ""}${format(i.after - i.before)}`]) }}>
      <div ref={ref} className="l-viz-hit" style={{ height }} role="img" aria-label={`${frame.title}: ${items.map((i) => `${i.label} ${format(i.before)} to ${format(i.after)}`).join(", ")}`}>
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
            <g className="l-viz-axis" aria-hidden>
              <line x1={x0} x2={x0} y1={18} y2={height - 6} />
              <line x1={x1} x2={x1} y1={18} y2={height - 6} />
              <text x={x0} y={10} textAnchor="middle" style={{ fontWeight: 600 }}>
                {labels[0]}
              </text>
              <text x={x1} y={10} textAnchor="middle" style={{ fontWeight: 600 }}>
                {labels[1]}
              </text>
            </g>
            {order.map((it, k) => {
              const on = it.label === lit;
              const c = lit === null ? "var(--l-ink-3)" : on ? "var(--l-accent)" : "var(--l-viz-gray)";
              return (
                <g key={it.label} className="l-viz-mark" onPointerEnter={() => setHot(it.label)} onPointerLeave={() => setHot(null)} style={{ opacity: lit !== null && !on ? 0.75 : 1 }} tabIndex={0} onFocus={() => setHot(it.label)} onBlur={() => setHot(null)} aria-label={`${it.label}: ${format(it.before)} to ${format(it.after)}`}>
                  <line x1={x0} x2={x1} y1={y(it.before)} y2={y(it.after)} stroke="transparent" strokeWidth={14} />
                  <line className="l-viz-draw" pathLength={1} style={{ animationDelay: `${k * 60}ms` }} x1={x0} x2={x1} y1={y(it.before)} y2={y(it.after)} stroke={c} strokeWidth={2} strokeLinecap="round" />
                  <circle className="l-viz-dot" cx={x0} cy={y(it.before)} r={4} fill={c} />
                  <circle className="l-viz-dot" cx={x1} cy={y(it.after)} r={4} fill={c} />
                  <text className={on ? "l-viz-label-strong" : "l-viz-label"} x={x0 - 10} y={y(it.before)} dy="0.32em" textAnchor="end">
                    {it.label} {format(it.before)}
                  </text>
                  <text className={on ? "l-viz-label-strong" : "l-viz-label"} x={x1 + 10} y={y(it.after)} dy="0.32em">
                    {format(it.after)} {it.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </ChartFrame>
  );
}
