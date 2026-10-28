/*
  Liner · Streamgraph
  How a whole and its parts flow over time. Layers stack around a center line; each is grey
  context until you point at it (or name it), when it takes the accent and its label. A
  sliver of the surface separates every layer, and the crosshair reads them all.
*/
import { useMemo, useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, type ChartFrameProps } from "../chart/chart";
import { compact, linear, nearest, ribbonPath } from "../chart/scale";
import { CAT, type Palette } from "../chart/palette";

export type StreamSeries = { id: string; label: string; data: number[] };
export type StreamgraphProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  series: StreamSeries[];
  x: string[];
  height?: number;
  focus?: string;
  palette?: Palette;
  format?: (v: number) => string;
};

export function Streamgraph({ series, x: labels, height = 220, focus, palette = "emphasis", format = compact, ...frame }: StreamgraphProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const w = size?.width ?? 0;
  // Emphasis always lights one layer: the named one, else the largest.
  const largest = series.reduce((b, s, i) => (s.data.reduce((a, v) => a + v, 0) > series[b].data.reduce((a, v) => a + v, 0) ? i : b), 0);
  const fixed = focus ? series.findIndex((s) => s.id === focus) : largest;
  const lit: number | null = hot ?? (palette === "categorical" ? null : fixed);
  const color = (i: number) => (palette === "categorical" ? CAT[i % 8] : i === lit ? "var(--l-accent-fill)" : "var(--l-viz-mid)");

  // Silhouette offset: each column's stack is centered on the middle line.
  const stacks = useMemo(
    () =>
      labels.map((_, k) => {
        const total = series.reduce((a, s) => a + s.data[k], 0);
        let base = -total / 2;
        return series.map((s) => {
          const lo = base;
          base += s.data[k];
          return [lo, base] as [number, number];
        });
      }),
    [series, labels],
  );
  const peak = Math.max(...labels.map((_, k) => series.reduce((a, s) => a + s.data[k], 0))) / 2;
  const x = linear([0, labels.length - 1], [0, w]);
  const y = linear([-peak, peak], [height - 24, 6]);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 70))));

  return (
    <ChartFrame
      {...frame}
      legend={series.map((s, i) => ({ label: s.label, color: color(i), muted: palette !== "categorical" && lit !== null && i !== lit }))}
      onLegendHover={(l) => setHot(l ? series.findIndex((s) => s.label === l) : null)}
      table={{ columns: ["", ...series.map((s) => s.label)], rows: labels.map((l, k) => [l, ...series.map((s) => s.data[k])]) }}
    >
      <div
        ref={ref}
        className="l-viz-hit"
        style={{ height }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = nearest(labels.map((_, i) => x(i)), e.clientX - r.left);
          setHover(k);
          const yy = y.invert(e.clientY - r.top);
          const layer = stacks[k].findIndex(([lo, hi]) => yy >= lo && yy <= hi);
          setHot(layer >= 0 ? layer : null);
        }}
        onPointerLeave={() => {
          setHover(null);
          setHot(null);
        }}
        role="img"
        aria-label={`${frame.title}: ${series.map((s) => s.label).join(", ")} over ${labels[0]} to ${labels[labels.length - 1]}`}
      >
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            {series.map((s, i) => (
              <path
                key={s.id}
                className="l-viz-mark l-viz-fade"
                style={{ animationDelay: `${i * 70}ms` }}
                d={ribbonPath(
                  stacks.map((c, k) => ({ x: x(k), y: y(c[i][1]) })),
                  stacks.map((c, k) => ({ x: x(k), y: y(c[i][0]) })),
                )}
                fill={color(i)}
                stroke="var(--l-card-fill)"
                strokeWidth={2}
              />
            ))}
            {lit !== null &&
              (() => {
                // Label the lit layer where it is thickest.
                const k = stacks.reduce((b, c, j) => (c[lit][1] - c[lit][0] > stacks[b][lit][1] - stacks[b][lit][0] ? j : b), 0);
                const [lo, hi] = stacks[k][lit];
                return y(lo) - y(hi) > 16 ? (
                  <text className="l-viz-fade" x={Math.min(Math.max(x(k), 40), w - 40)} y={(y(lo) + y(hi)) / 2} dy="0.32em" textAnchor="middle" fill="var(--l-accent-ink)" style={{ fontSize: 11.5, fontWeight: 600, fill: "var(--l-accent-ink)" }}>
                    {series[lit].label}
                  </text>
                ) : null;
              })()}
            <g className="l-viz-axis">
              {labels.map((l, i) =>
                i % every === 0 ? (
                  <text key={i} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : "middle"}>
                    {l}
                  </text>
                ) : null,
              )}
            </g>
            {hover !== null && <line className="l-viz-cross" x1={x(hover)} x2={x(hover)} y1={0} y2={height - 22} />}
          </svg>
        )}
        {hover !== null && w > 0 && (
          <ChartTip
            x={x(hover)}
            y={height / 2}
            width={w}
            title={labels[hover]}
            rows={series.map((s, i) => ({ label: s.label, value: format(s.data[hover]), color: color(i), kind: "rect" as const })).reverse()}
          />
        )}
      </div>
    </ChartFrame>
  );
}
