/*
  Liner · Sparkline
  A trend in a word's worth of space. The line wears the quiet grey; the current point is
  the accent, so the eye lands on now. Hovering walks the line with a crosshair and a value.
*/
import { useState } from "react";
import { cx, useSize } from "../../lib/hooks";
import { linear, nearest, smoothPath } from "../chart/scale";
import "../chart/chart.css";
import "./sparkline.css";

export type SparklineProps = {
  data: number[];
  /** A label per point for the tooltip, like dates. */
  labels?: string[];
  height?: number;
  format?: (v: number) => string;
  /** Fill the area under the line with a faint wash. */
  area?: boolean;
  label?: string;
  className?: string;
};

export function Sparkline({ data, labels, height = 36, format = (v) => v.toLocaleString("en-US"), area = true, label = "Trend", className }: SparklineProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = size?.width ?? 0;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const pad = 4;
  const x = linear([0, data.length - 1], [pad, Math.max(pad, w - pad)]);
  const y = linear([lo, hi === lo ? lo + 1 : hi], [height - pad, pad]);
  const pts = data.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const at = hover ?? data.length - 1;
  return (
    <div
      ref={ref}
      className={cx("l-spark", className)}
      style={{ height }}
      role="img"
      aria-label={`${label}: from ${format(data[0])} to ${format(data[data.length - 1])}, low ${format(lo)}, high ${format(hi)}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover(nearest(pts.map((p) => p.x), e.clientX - r.left));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
          {area && <path className="l-spark__area" d={`${line}L${last.x},${height}L${pts[0].x},${height}Z`} />}
          <path className="l-spark__line" d={line} />
          {hover !== null && <line className="l-viz-cross" x1={pts[at].x} x2={pts[at].x} y1={0} y2={height} />}
          <circle className="l-spark__now l-viz-dot" cx={pts[at].x} cy={pts[at].y} r={hover !== null ? 3.5 : 4} data-hover={hover !== null || undefined} />
        </svg>
      )}
      {hover !== null && w > 0 && (
        <span className="l-spark__tip l-glass" style={{ left: pts[at].x }} aria-hidden>
          <b>{format(data[at])}</b>
          {labels?.[at] && <span>{labels[at]}</span>}
        </span>
      )}
    </div>
  );
}
