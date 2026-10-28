/*
  Liner · Line chart
  Change over time. One series is the accent with a faint wash under it; several default to
  emphasis, where the one you point at (or name) is the accent and the rest are context.
  A crosshair finds the nearest point, and one tooltip reads every series there.
*/
import { useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, GridY, type ChartFrameProps } from "../chart/chart";
import { areaPath, compact, linear, nearest, niceTicks, smoothPath } from "../chart/scale";
import { seriesColor, type Palette } from "../chart/palette";

export type LineSeries = { id: string; label: string; data: number[] };
export type LineChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  series: LineSeries[];
  x: string[];
  height?: number;
  format?: (v: number) => string;
  /** The series that matters; the others become context. */
  focus?: string;
  palette?: Palette;
  /** Start the y axis at zero (on by default for honest magnitude). */
  zero?: boolean;
};

export function LineChart({ series, x: labels, height = 220, format = compact, focus, palette = "emphasis", zero = true, ...frame }: LineChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const w = size?.width ?? 0;
  const m = { l: 40, r: 64, t: 10, b: 26 };
  const all = series.flatMap((s) => s.data);
  const { ticks, min, max } = niceTicks(zero ? Math.min(0, ...all) : Math.min(...all), Math.max(...all), 4);
  const x = linear([0, labels.length - 1], [m.l, Math.max(m.l + 1, w - m.r)]);
  const y = linear([min, max], [height - m.b, m.t]);
  const fixed = focus ? series.findIndex((s) => s.id === focus) : null;
  const lit = hot ?? fixed;
  const color = (i: number) => seriesColor(i, series.length, palette, lit);
  const xs = labels.map((_, i) => x(i));
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((w - m.l - m.r) / 64))));
  // Draw context lines first so the accent sits on top.
  const order = series.map((_, i) => i).sort((a, b) => (a === (lit ?? 0) ? 1 : 0) - (b === (lit ?? 0) ? 1 : 0));

  return (
    <ChartFrame
      {...frame}
      legend={series.map((s, i) => ({ label: s.label, color: color(i), kind: "line", muted: palette === "emphasis" && series.length > 1 && i !== (lit ?? 0) }))}
      onLegendHover={(l) => setHot(l ? series.findIndex((s) => s.label === l) : null)}
      table={{ columns: ["", ...series.map((s) => s.label)], rows: labels.map((l, i) => [l, ...series.map((s) => s.data[i])]) }}
    >
      <div
        ref={ref}
        className="l-viz-hit"
        style={{ height }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(nearest(xs, e.clientX - r.left));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${frame.title}: ${series.map((s) => `${s.label} from ${format(s.data[0])} to ${format(s.data[s.data.length - 1])}`).join("; ")}`}
      >
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            <GridY ticks={ticks} y={y} x0={m.l} x1={w - m.r + 8} format={format} />
            <g className="l-viz-axis">
              {labels.map((l, i) =>
                i % every === 0 || i === labels.length - 1 ? (
                  <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>
                    {l}
                  </text>
                ) : null,
              )}
            </g>
            {series.length === 1 && <path className="l-viz-fade" d={areaPath(series[0].data.map((v, i) => ({ x: x(i), y: y(v) })), y(Math.max(min, 0)))} fill="var(--l-accent)" opacity={0.1} />}
            {order.map((i) => {
              const s = series[i];
              const pts = s.data.map((v, k) => ({ x: x(k), y: y(v) }));
              return <path key={s.id} className="l-viz-draw l-viz-mark" pathLength={1} d={smoothPath(pts)} fill="none" stroke={color(i)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
            })}
            {/* Direct labels at the line ends: the lit series, or every series when they each have a hue (up to four). */}
            {series.map((s, i) => {
              const show = series.length === 1 || i === (lit ?? 0) || (palette === "categorical" && series.length <= 4);
              if (!show) return null;
              const v = s.data[s.data.length - 1];
              return (
                <g key={s.id} className="l-viz-fade">
                  <circle className="l-viz-dot" cx={x(labels.length - 1)} cy={y(v)} r={4} fill={color(i)} />
                  <text className="l-viz-label-strong" x={x(labels.length - 1) + 9} y={y(v)} dy="0.32em">
                    {format(v)}
                  </text>
                  {series.length > 1 && (
                    <text className="l-viz-label" x={x(labels.length - 1) + 9} y={y(v) + 14} dy="0.32em">
                      {s.label}
                    </text>
                  )}
                </g>
              );
            })}
            {hover !== null && (
              <g>
                <line className="l-viz-cross" x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} />
                {series.map((s, i) => (
                  <circle key={s.id} className="l-viz-dot" cx={x(hover)} cy={y(s.data[hover])} r={4} fill={color(i)} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && w > 0 && (
          <ChartTip
            x={x(hover)}
            y={Math.min(...series.map((s) => y(s.data[hover])))}
            width={w}
            title={labels[hover]}
            rows={series
              .map((s, i) => ({ label: s.label, value: format(s.data[hover]), color: color(i), v: s.data[hover] }))
              .sort((a, b) => b.v - a.v)
              .map(({ v, ...r }) => r)}
          />
        )}
      </div>
    </ChartFrame>
  );
}
