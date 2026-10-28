/*
  Liner · Live stream chart
  A value as it arrives. The line glides left by one step per tick, so new readings slide in
  from the edge instead of jumping; the latest value rolls at the top. Pointing at the line
  holds it still so you can read a moment, and Pause stops it outright.
*/
import { useEffect, useRef, useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, GridY, type ChartFrameProps } from "../chart/chart";
import { areaPath, linear, nearest, niceTicks, smoothPath } from "../chart/scale";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./stream-chart.css";

export type StreamChartProps = Omit<ChartFrameProps, "children" | "legend" | "table" | "figure"> & {
  /** Called once per tick for the next reading. */
  next: () => number;
  seed?: number[];
  interval?: number;
  window?: number;
  unit?: string;
  height?: number;
  /** A line people should notice crossing, like an alert threshold. */
  threshold?: number;
};

export function StreamChart({ next, seed = [], interval = 1000, window: span = 40, unit = "", height = 170, threshold, ...frame }: StreamChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [vals, setVals] = useState<number[]>(() => {
    const s = [...seed];
    while (s.length < span + 1) s.unshift(s[0] ?? next());
    return s.slice(-(span + 1));
  });
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  const hold = paused || hover !== null;
  useEffect(() => {
    if (hold) return;
    const id = window.setInterval(() => {
      setVals((v) => [...v.slice(1), nextRef.current()]);
      setTick((t) => t + 1);
    }, interval);
    return () => window.clearInterval(id);
  }, [hold, interval]);

  const w = size?.width ?? 0;
  const m = { l: 36, r: 12 };
  const { ticks, min, max } = niceTicks(Math.min(threshold ?? Infinity, ...vals) * 0.9, Math.max(threshold ?? -Infinity, ...vals) * 1.05, 3);
  const step = (w - m.l - m.r) / (span - 1);
  // The newest point starts just past the right edge; each tick the group slides left one
  // step, carrying it into view. At rest the drawing sits at that slid position.
  const x = (i: number) => m.l + i * step;
  const y = linear([min, max], [height - 8, 8]);
  const pts = vals.map((v, i) => ({ x: x(i), y: y(v) }));
  const last = vals[vals.length - 1];
  const over = threshold !== undefined && last > threshold;
  return (
    <ChartFrame
      {...frame}
      figure={
        <span className="l-stream__now" data-over={over || undefined}>
          <RollingNumber value={Math.round(last)} />
          <small>{unit}</small>
        </span>
      }
      actions={
        <>
          <button type="button" className="l-stream__pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            {paused ? (
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M5 3.5v9l7.5-4.5L5 3.5Z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden>
                <rect x="4" y="3.5" width="2.6" height="9" rx="1" fill="currentColor" />
                <rect x="9.4" y="3.5" width="2.6" height="9" rx="1" fill="currentColor" />
              </svg>
            )}
            {paused ? "Resume" : "Pause"}
          </button>
          <span className="l-stream__status" key={String(hold)}>
            {paused ? "Paused" : hover !== null ? "Held while you read" : "Live"}
          </span>
        </>
      }
      table={{ columns: ["Reading", frame.title], rows: vals.map((v, i) => [`−${(vals.length - 1 - i) * (interval / 1000)}s`, Math.round(v)]) }}
    >
      <div
        ref={ref}
        className="l-viz-hit"
        style={{ height }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(1, nearest(pts.map((p) => p.x - step), e.clientX - r.left)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${frame.title}: now ${Math.round(last)}${unit}`}
      >
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            <defs>
              <clipPath id="l-stream-clip">
                <rect x={m.l} y={0} width={w - m.l - m.r} height={height} />
              </clipPath>
            </defs>
            <GridY ticks={ticks} y={y} x0={m.l} x1={w - m.r} />
            {threshold !== undefined && (
              <g>
                <line x1={m.l} x2={w - m.r} y1={y(threshold)} y2={y(threshold)} stroke="var(--l-warn)" strokeWidth={1.5} />
                <text x={w - m.r} y={y(threshold) - 5} textAnchor="end" style={{ fill: "var(--l-warn-text)", fontWeight: 600 }}>
                  Alert {threshold}
                  {unit}
                </text>
              </g>
            )}
            <g clipPath="url(#l-stream-clip)">
              <g key={tick} className="l-stream__slide" data-hold={hold || undefined} style={{ ["--step" as string]: `${step}px`, animationDuration: `${interval}ms` }}>
                <path d={areaPath(pts, height)} fill="var(--l-accent)" opacity={0.1} />
                <path d={smoothPath(pts)} fill="none" stroke="var(--l-accent)" strokeWidth={2} strokeLinejoin="round" />
                <circle className="l-viz-dot" cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} fill={over ? "var(--l-warn)" : "var(--l-accent)"} />
              </g>
            </g>
            {hover !== null && (
              <>
                <line className="l-viz-cross" x1={pts[hover].x - step} x2={pts[hover].x - step} y1={8} y2={height - 8} />
                <circle className="l-viz-dot" cx={pts[hover].x - step} cy={pts[hover].y} r={4} fill="var(--l-ink)" />
              </>
            )}
          </svg>
        )}
        {hover !== null && w > 0 && <ChartTip x={pts[hover].x - step} y={pts[hover].y} width={w} title={`${((vals.length - 1 - hover) * interval) / 1000}s ago`} rows={[{ label: frame.title, value: `${Math.round(vals[hover])}${unit}`, color: "var(--l-accent)" }]} />}
      </div>
    </ChartFrame>
  );
}
