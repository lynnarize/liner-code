/*
  Liner · Donut chart
  Part of a whole, at a glance, for six parts or fewer. One part is lit in the accent (the
  largest, until you point at another) and its share is the figure in the middle; the rest
  wait in grey, separated by a sliver of the surface. The legend always lists every part.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { arcPath } from "../chart/scale";
import { CAT, type Palette } from "../chart/palette";
import "./donut-chart.css";

export type DonutDatum = { label: string; value: number };
export type DonutChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  data: DonutDatum[];
  size?: number;
  format?: (v: number) => string;
  palette?: Palette;
};

export function DonutChart({ data, size = 180, format = (v) => v.toLocaleString("en-US"), palette = "emphasis", ...frame }: DonutChartProps) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const largest = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
  const [active, setActive] = useState<number | null>(null);
  const lit = active ?? largest;
  const r1 = size / 2;
  const r0 = r1 * 0.66;
  const gap = 2 / r1; // a 2px sliver of surface between parts, as an angle
  const color = (i: number) => (palette === "categorical" ? CAT[i % 8] : i === lit ? "var(--l-accent)" : "var(--l-viz-gray)");
  let a = 0;
  const arcs = data.map((d) => {
    const span = (d.value / total) * Math.PI * 2;
    const arc = { a0: a + gap / 2, a1: a + span - gap / 2 };
    a += span;
    return arc;
  });
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <ChartFrame {...frame} table={{ columns: ["", "Value", "Share"], rows: data.map((d) => [d.label, d.value, pct(d.value)]) }}>
      <div className="l-donut">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${frame.title}: ${data.map((d) => `${d.label} ${pct(d.value)}`).join(", ")}`}>
          {data.map((d, i) => (
            <path
              key={d.label}
              className="l-viz-mark l-donut__seg"
              data-lit={i === lit || undefined}
              style={{ animationDelay: `${i * 60}ms` }}
              d={arcPath(r1, r1, r0, r1 - (i === lit ? 0 : 3), arcs[i].a0, arcs[i].a1)}
              fill={color(i)}
              tabIndex={0}
              aria-label={`${d.label}: ${format(d.value)}, ${pct(d.value)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="l-donut__center" aria-hidden>
          <b key={`v${lit}`}>{pct(data[lit].value)}</b>
          <span key={`l${lit}`}>{data[lit].label}</span>
        </div>
      </div>
      <ul className="l-donut__legend">
        {data.map((d, i) => (
          <li key={d.label} className={cx(i === lit && "is-lit")} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
            <i style={{ background: color(i) }} aria-hidden />
            <span>{d.label}</span>
            <b>{format(d.value)}</b>
            <em>{pct(d.value)}</em>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
