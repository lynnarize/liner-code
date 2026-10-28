/*
  Liner Pro · Split bar
  Agreement on a scale, centered where opinion is neutral. Disagree runs left in the pole
  opposite the accent, agree runs right in the accent, each in two equal steps, with a grey
  middle for neutral. Totals sit at both ends; a part only carries its number if it fits.
*/
import { useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, type ChartFrameProps } from "../../components/chart/chart";
import { linear } from "../../components/chart/scale";

export type SplitRow = { label: string; values: [number, number, number, number, number] };
export type SplitBarProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  rows: SplitRow[];
  scale?: [string, string, string, string, string];
};

// The strongest answers carry their percentages, so they sit one ramp step deeper (l4) for 4.5:1 labels.
const COLORS = ["oklch(from var(--l-viz-neg) var(--l-viz-l4) c h)", "var(--l-viz-neg-soft)", "var(--l-viz-mid)", "var(--l-viz-1)", "var(--l-viz-4)"];

export function SplitBar({ rows, scale = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"], ...frame }: SplitBarProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hot, setHot] = useState<{ r: number; k: number } | null>(null);
  const w = size?.width ?? 0;
  const lab = Math.min(150, w * 0.28);
  const rowH = 34;
  const height = rows.length * rowH + 26;
  // The widest side decides the scale, so every row shares one center and one unit.
  const left = Math.max(...rows.map((r) => r.values[0] + r.values[1] + r.values[2] / 2));
  const right = Math.max(...rows.map((r) => r.values[4] + r.values[3] + r.values[2] / 2));
  // Disagree totals get their own column between the labels and the bars, so they never collide.
  const x = linear([-left, right], [lab + 48, w - 40]);
  const t = 20;
  return (
    <ChartFrame
      {...frame}
      legend={scale.map((s, i) => ({ label: s, color: COLORS[i] }))}
      table={{ columns: ["", ...scale], rows: rows.map((r) => [r.label, ...r.values.map((v) => `${v}%`)]) }}
    >
      <div ref={ref} className="l-viz-hit" style={{ height }} role="img" aria-label={`${frame.title}: ${rows.map((r) => `${r.label}, ${r.values[3] + r.values[4]}% agree, ${r.values[0] + r.values[1]}% disagree`).join("; ")}`} onPointerLeave={() => setHot(null)}>
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            <line x1={x(0)} x2={x(0)} y1={0} y2={height - 20} stroke="var(--l-line-strong)" />
            {rows.map((r, ri) => {
              const yy = ri * rowH + (rowH - t) / 2;
              let at = -(r.values[0] + r.values[1] + r.values[2] / 2);
              return (
                <g key={r.label}>
                  <text className="l-viz-label" x={lab} y={yy + t / 2} dy="0.32em" textAnchor="end" style={{ fill: "var(--l-ink)" }}>
                    {r.label}
                  </text>
                  <text x={lab + 40} y={yy + t / 2} dy="0.32em" textAnchor="end" className="l-viz-label">
                    {r.values[0] + r.values[1]}%
                  </text>
                  {r.values.map((v, k) => {
                    const x0 = x(at);
                    at += v;
                    const x1 = x(at);
                    const wid = Math.max(0, x1 - x0 - 2);
                    const fits = wid > 30;
                    return (
                      <g key={k} onPointerEnter={() => setHot({ r: ri, k })}>
                        <rect className="l-viz-mark l-viz-grow" data-dir="x" style={{ animationDelay: `${ri * 60}ms`, opacity: hot && (hot.r !== ri || hot.k !== k) ? 0.6 : 1 }} x={x0 + 1} y={yy} width={wid} height={t} rx={k === 0 || k === 4 ? 4 : 1.5} fill={COLORS[k]} />
                        {fits && (
                          <text x={x0 + 1 + wid / 2} y={yy + t / 2} dy="0.32em" textAnchor="middle" style={{ fill: k === 2 ? "var(--l-ink-2)" : k === 1 || k === 3 ? "var(--l-ink)" : "var(--l-on-ink)", fontSize: 10.5, fontWeight: 600 }}>
                            {v}%
                          </text>
                        )}
                      </g>
                    );
                  })}
                  <text x={x(at) + 6} y={yy + t / 2} dy="0.32em" className="l-viz-label-strong">
                    {r.values[3] + r.values[4]}%
                  </text>
                </g>
              );
            })}
            <g className="l-viz-axis">
              <text x={lab + 48} y={height - 4}>
                ← Disagree
              </text>
              <text x={w - 40} y={height - 4} textAnchor="end">
                Agree →
              </text>
            </g>
          </svg>
        )}
        {hot && w > 0 && (
          <ChartTip x={x(0)} y={hot.r * rowH + rowH / 2} width={w} title={rows[hot.r].label} rows={[{ label: scale[hot.k], value: `${rows[hot.r].values[hot.k]}%`, color: COLORS[hot.k], kind: "rect" }]} />
        )}
      </div>
    </ChartFrame>
  );
}
