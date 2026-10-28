/*
  Liner · Brush chart
  A long series with a window you choose. The small overview below shows everything; drag
  the window, or its edges, and the chart above zooms to just that stretch.
*/
import { useRef, useState, type KeyboardEvent } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, GridY, type ChartFrameProps } from "../chart/chart";
import { areaPath, compact, linear, nearest, niceTicks, smoothPath } from "../chart/scale";
import { clamp } from "../../lib/spring";
import "./brush-chart.css";

export type BrushChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  data: number[];
  x: string[];
  defaultRange?: [number, number];
  height?: number;
  format?: (v: number) => string;
};

export function BrushChart({ data, x: labels, defaultRange, height = 200, format = compact, ...frame }: BrushChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const n = data.length;
  const [range, setRange] = useState<[number, number]>(defaultRange ?? [Math.floor(n * 0.55), n - 1]);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ kind: "lo" | "hi" | "both"; x: number; r: [number, number] } | null>(null);
  const w = size?.width ?? 0;
  const m = { l: 40, r: 10 };
  const [a, b] = range;
  const slice = data.slice(a, b + 1);
  const { ticks, min, max } = niceTicks(Math.min(0, ...slice), Math.max(...slice), 4);
  const x = linear([a, b], [m.l, w - m.r]);
  const y = linear([min, max], [height - 22, 8]);
  const ov = 48;
  const ox = linear([0, n - 1], [m.l, w - m.r]);
  const oy = linear([Math.min(0, ...data), Math.max(...data)], [ov - 4, 4]);
  const pts = slice.map((v, i) => ({ x: x(a + i), y: y(v) }));
  const minSpan = Math.max(3, Math.round(n * 0.06));

  const toIndex = (px: number) => Math.round(ox.invert(px));
  const move = (clientX: number, rect: DOMRect) => {
    const d = drag.current;
    if (!d) return;
    const dx = toIndex(clientX - rect.left) - toIndex(d.x - rect.left);
    const [lo, hi] = d.r;
    if (d.kind === "both") {
      const span = hi - lo;
      const nlo = clamp(lo + dx, 0, n - 1 - span);
      setRange([nlo, nlo + span]);
    } else if (d.kind === "lo") setRange([clamp(lo + dx, 0, hi - minSpan), hi]);
    else setRange([lo, clamp(hi + dx, lo + minSpan, n - 1)]);
  };
  const key = (kind: "lo" | "hi" | "both") => (e: KeyboardEvent) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setRange(([lo, hi]) => (kind === "both" ? (lo + d * step >= 0 && hi + d * step <= n - 1 ? [lo + d * step, hi + d * step] : [lo, hi]) : kind === "lo" ? [clamp(lo + d * step, 0, hi - minSpan), hi] : [lo, clamp(hi + d * step, lo + minSpan, n - 1)]));
  };

  return (
    <ChartFrame {...frame} subtitle={frame.subtitle ?? `${labels[a]} – ${labels[b]}`} table={{ columns: ["", frame.title], rows: labels.map((l, i) => [l, data[i]]) }}>
      <div ref={ref}>
        <div
          className="l-viz-hit"
          style={{ height }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(a + nearest(pts.map((p) => p.x), e.clientX - r.left));
          }}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${frame.title} from ${labels[a]} to ${labels[b]}: ${format(slice[0])} to ${format(slice[slice.length - 1])}`}
        >
          {w > 0 && (
            <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
              <GridY ticks={ticks} y={y} x0={m.l} x1={w - m.r} format={format} />
              <path d={areaPath(pts, y(Math.max(0, min)))} fill="var(--l-accent)" opacity={0.1} />
              <path d={smoothPath(pts)} fill="none" stroke="var(--l-accent)" strokeWidth={2} strokeLinejoin="round" />
              <g className="l-viz-axis">
                <text x={m.l} y={height - 4}>
                  {labels[a]}
                </text>
                <text x={w - m.r} y={height - 4} textAnchor="end">
                  {labels[b]}
                </text>
              </g>
              {hover !== null && (
                <>
                  <line className="l-viz-cross" x1={x(hover)} x2={x(hover)} y1={8} y2={height - 22} />
                  <circle className="l-viz-dot" cx={x(hover)} cy={y(data[hover])} r={4} fill="var(--l-accent)" />
                </>
              )}
            </svg>
          )}
          {hover !== null && w > 0 && <ChartTip x={x(hover)} y={y(data[hover])} width={w} title={labels[hover]} rows={[{ label: frame.title, value: format(data[hover]), color: "var(--l-accent)" }]} />}
        </div>
        {w > 0 && (
          <div
            className="l-brush"
            style={{ height: ov }}
            onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            <svg width={w} height={ov} viewBox={`0 0 ${w} ${ov}`} aria-hidden>
              <path d={areaPath(data.map((v, i) => ({ x: ox(i), y: oy(v) })), ov)} fill="var(--l-viz-gray)" opacity={0.25} />
              <path d={smoothPath(data.map((v, i) => ({ x: ox(i), y: oy(v) })))} fill="none" stroke="var(--l-viz-gray)" strokeWidth={1.5} />
            </svg>
            <div className="l-brush__shade" style={{ left: m.l, width: ox(a) - m.l }} />
            <div className="l-brush__shade" style={{ left: ox(b), right: m.r }} />
            <div
              className="l-brush__window"
              role="slider"
              tabIndex={0}
              aria-label="Window"
              aria-valuetext={`${labels[a]} to ${labels[b]}`}
              aria-valuenow={a}
              aria-valuemin={0}
              aria-valuemax={n - 1}
              style={{ left: ox(a), width: ox(b) - ox(a) }}
              onKeyDown={key("both")}
              onPointerDown={(e) => {
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
                drag.current = { kind: "both", x: e.clientX, r: range };
              }}
            >
              {(["lo", "hi"] as const).map((k) => (
                <span
                  key={k}
                  className="l-brush__handle"
                  data-side={k}
                  role="slider"
                  tabIndex={0}
                  aria-label={k === "lo" ? "Window start" : "Window end"}
                  aria-valuetext={labels[k === "lo" ? a : b]}
                  aria-valuenow={k === "lo" ? a : b}
                  aria-valuemin={0}
                  aria-valuemax={n - 1}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    key(k)(e);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.parentElement!.parentElement!.setPointerCapture(e.pointerId);
                    drag.current = { kind: k, x: e.clientX, r: range };
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
