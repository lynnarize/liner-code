/*
  Liner · Radar
  A profile across a few measures on one shared scale: you against a benchmark, say. The
  subject is the accent with a faint wash; the comparison is a grey outline. Rings are
  hairlines; pointing at an axis reads both values on it.
*/
import { useState } from "react";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import "./radar.css";

export type RadarSeries = { label: string; values: number[] };
export type RadarProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  axes: string[];
  /** The subject first, then at most one comparison. */
  series: [RadarSeries] | [RadarSeries, RadarSeries];
  max?: number;
  size?: number;
};

export function Radar({ axes, series, max = 100, size = 260, ...frame }: RadarProps) {
  const [axis, setAxis] = useState<number | null>(null);
  const c = size / 2;
  const r = c - 44;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / n;
    return [c + r * (v / max) * Math.sin(a), c - r * (v / max) * Math.cos(a)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  const colors = ["var(--l-accent)", "var(--l-viz-gray)"];
  return (
    <ChartFrame {...frame} legend={series.map((s, i) => ({ label: s.label, color: colors[i], kind: "line" as const }))} table={{ columns: ["", ...series.map((s) => s.label)], rows: axes.map((a, i) => [a, ...series.map((s) => s.values[i])]) }}>
      <div className="l-radar">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${frame.title}: ${axes.map((a, i) => `${a} ${series.map((s) => s.values[i]).join(" vs ")}`).join(", ")}`}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <polygon key={f} points={poly(axes.map(() => max * f))} className="l-radar__ring" />
          ))}
          {axes.map((a, i) => {
            const [x, y] = pt(i, max);
            const [lx, ly] = pt(i, max * 1.17);
            return (
              <g key={a} onPointerEnter={() => setAxis(i)} onPointerLeave={() => setAxis(null)}>
                <line x1={c} y1={c} x2={x} y2={y} className="l-radar__spoke" data-on={axis === i || undefined} />
                <line x1={c} y1={c} x2={x} y2={y} stroke="transparent" strokeWidth={22} />
                <text x={lx} y={ly} dy="0.32em" textAnchor={Math.abs(lx - c) < 4 ? "middle" : lx > c ? "start" : "end"} className={axis === i ? "l-viz-label-strong" : "l-viz-label"}>
                  {a}
                </text>
              </g>
            );
          })}
          {[...series].reverse().map((s, ri) => {
            const i = series.length - 1 - ri;
            return (
              <g key={s.label} className="l-radar__shape" style={{ animationDelay: `${i * 120}ms` }}>
                <polygon points={poly(s.values)} fill={i === 0 ? "var(--l-accent)" : "none"} fillOpacity={0.1} stroke={colors[i]} strokeWidth={2} strokeLinejoin="round" />
                {s.values.map((v, k) => {
                  const [x, y] = pt(k, v);
                  return <circle key={k} className="l-viz-dot" cx={x} cy={y} r={axis === k ? 5 : 3.5} fill={colors[i]} />;
                })}
              </g>
            );
          })}
        </svg>
        <div className="l-radar__read" aria-live="polite" key={axis ?? "none"}>
          {axis !== null ? (
            <>
              <b>{axes[axis]}</b>
              {series.map((s, i) => (
                <span key={s.label}>
                  <i style={{ background: colors[i] }} />
                  {s.values[axis]} {s.label}
                </span>
              ))}
            </>
          ) : (
            <span className="l-radar__hint">Point at an axis to compare</span>
          )}
        </div>
      </div>
    </ChartFrame>
  );
}
