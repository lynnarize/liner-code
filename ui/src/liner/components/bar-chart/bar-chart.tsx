/*
  Liner · Bar chart
  Comparing amounts. Every bar wears the one accent (they are one series); naming a bar
  turns the chart into emphasis, with the rest in grey. Bars are thin, round only at their
  data end, and grow from a single baseline. Horizontal bars carry their values at the tip.
*/
import { useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, GridY, type ChartFrameProps } from "../chart/chart";
import { band, compact, linear, niceTicks } from "../chart/scale";
import { ACCENT, GRAY } from "../chart/palette";

export type BarDatum = { label: string; value: number };
export type BarChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  data: BarDatum[];
  orientation?: "vertical" | "horizontal";
  /** The bar the story is about; the others turn grey. */
  focus?: string;
  height?: number;
  format?: (v: number) => string;
};

/** A bar with 4px rounded corners at its data end only, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean) {
  const r = Math.min(4, horizontal ? h / 2 : w / 2, horizontal ? w : h);
  if (horizontal) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({ data, orientation = "vertical", focus, height, format = compact, ...frame }: BarChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = size?.width ?? 0;
  const horizontal = orientation === "horizontal";
  const h = height ?? (horizontal ? data.length * 34 + 8 : 220);
  const max = Math.max(...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max);
  const color = (i: number) => (focus ? (data[i].label === focus ? ACCENT : GRAY) : ACCENT);

  const plot = () => {
    if (horizontal) {
      const labelW = Math.min(140, Math.max(...data.map((d) => d.label.length)) * 7 + 12);
      const x = linear([0, max], [labelW, w - 56]);
      const b = band(data.length, [0, h], 0.36);
      const t = Math.min(24, b.width);
      return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
          {data.map((d, i) => {
            const yy = b.at(i) + (b.width - t) / 2;
            return (
              <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={0} y={b.at(i) - 4} width={w} height={b.width + 8} fill="transparent" />
                <text className="l-viz-label" x={labelW - 10} y={yy + t / 2} dy="0.32em" textAnchor="end">
                  {d.label}
                </text>
                <path className="l-viz-grow l-viz-mark" data-dir="x" style={{ animationDelay: `${i * 40}ms`, opacity: hover !== null && hover !== i ? 0.55 : 1 }} d={barPath(labelW, yy, Math.max(1, x(d.value) - labelW), t, true)} fill={color(i)} />
                <text className="l-viz-label-strong l-viz-fade" x={x(d.value) + 8} y={yy + t / 2} dy="0.32em">
                  {format(d.value)}
                </text>
              </g>
            );
          })}
          <line className="l-viz-axis-line" x1={labelW} x2={labelW} y1={0} y2={h} stroke="var(--l-line-strong)" />
        </svg>
      );
    }
    const m = { l: 40, r: 8, t: 18, b: 26 };
    const { ticks, max: top } = niceTicks(0, max, 4);
    const y = linear([0, top], [h - m.b, m.t]);
    const b = band(data.length, [m.l, w - m.r], 0.3);
    const t = Math.min(24, b.width);
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <GridY ticks={ticks} y={y} x0={m.l} x1={w - m.r} format={format} />
        {data.map((d, i) => {
          const xx = b.at(i) + (b.width - t) / 2;
          const show = i === hover || i === peak || d.label === focus;
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={b.at(i) - (b.step - b.width) / 2} y={m.t} width={b.step} height={h - m.t - m.b} fill="transparent" />
              <path className="l-viz-grow l-viz-mark" style={{ animationDelay: `${i * 40}ms`, opacity: hover !== null && hover !== i ? 0.55 : 1 }} d={barPath(xx, y(d.value), t, Math.max(1, y(0) - y(d.value)), false)} fill={color(i)} />
              {show && (
                <text className="l-viz-label-strong l-viz-fade" x={xx + t / 2} y={y(d.value) - 7} textAnchor="middle">
                  {format(d.value)}
                </text>
              )}
              <text x={xx + t / 2} y={h - 6} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <ChartFrame {...frame} table={{ columns: ["", frame.title], rows: data.map((d) => [d.label, d.value]) }}>
      <div ref={ref} className="l-viz-hit" style={{ height: h }} role="img" aria-label={`${frame.title}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
        {w > 0 && plot()}
        {hover !== null && w > 0 && !horizontal && (
          <ChartTip x={((hover + 0.5) / data.length) * (w - 48) + 40} y={40} width={w} align="above" rows={[{ label: data[hover].label, value: format(data[hover].value), color: color(hover), kind: "rect" }]} />
        )}
      </div>
    </ChartFrame>
  );
}
