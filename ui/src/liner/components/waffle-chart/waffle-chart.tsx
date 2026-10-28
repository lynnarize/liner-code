/*
  Liner · Waffle chart
  A share as a hundred squares, so “62 in 100” can be counted, not just guessed. Parts are
  ordered (done, in progress, not started), so they take the accent's steps from dark to
  light; what is left stays a faint wash. Squares fill in a short sweep.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { STEPS } from "../chart/palette";
import "./waffle-chart.css";

export type WafflePart = { label: string; value: number };
export type WaffleChartProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  /** Ordered parts, most important first. Values are out of `total`. */
  parts: WafflePart[];
  total?: number;
  rest?: string;
};

// Darkest first: the leading part reads strongest.
const ORDER = [STEPS[4], STEPS[2], STEPS[0]];

export function WaffleChart({ parts, total = 100, rest = "Remaining", ...frame }: WaffleChartProps) {
  const [hot, setHot] = useState<number | null>(null);
  const cells: number[] = [];
  parts.forEach((p, i) => {
    for (let k = 0; k < Math.round((p.value / total) * 100); k++) cells.push(i);
  });
  while (cells.length < 100) cells.push(-1);
  const color = (i: number) => (i < 0 ? "var(--l-wash-2)" : parts.length === 1 ? "var(--l-accent)" : ORDER[i] ?? STEPS[0]);
  const used = parts.reduce((a, p) => a + p.value, 0);
  return (
    <ChartFrame
      {...frame}
      figure={frame.figure ?? `${Math.round((parts[0].value / total) * 100)}%`}
      legend={[...parts.map((p, i) => ({ label: p.label, color: color(i) })), { label: rest, color: "var(--l-wash-3)" }]}
      onLegendHover={(l) => setHot(l === null ? null : l === rest ? -1 : parts.findIndex((p) => p.label === l))}
      table={{ columns: ["", "Value", "Share"], rows: [...parts.map((p) => [p.label, p.value, `${Math.round((p.value / total) * 100)}%`]), [rest, total - used, `${Math.round(((total - used) / total) * 100)}%`]] }}
    >
      <div className="l-waffle" role="img" aria-label={`${frame.title}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)} in 100`).join(", ")}`} data-hot={hot !== null || undefined}>
        {cells.map((c, i) => (
          // Fill column by column, so each part reads as a block.
          <i
            key={i}
            className={cx("l-waffle__cell", hot !== null && hot === c && "is-hot")}
            style={{ background: color(c), animationDelay: `${(i % 10) * 18 + Math.floor(i / 10) * 30}ms`, gridColumn: Math.floor(i / 10) + 1, gridRow: (i % 10) + 1 }}
            onPointerEnter={() => setHot(c)}
            onPointerLeave={() => setHot(null)}
          />
        ))}
      </div>
    </ChartFrame>
  );
}
