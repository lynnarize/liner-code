/*
  Liner · Sunburst
  A hierarchy as rings: the center is the whole, each ring a level down, angle is share.
  Rings are ordered by depth, so they take the accent's steps from the center out. Pointing
  at a part lights its path back to the center, greys the rest, and names it in the middle.
*/
import { useMemo, useState } from "react";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { arcPath, compact } from "../chart/scale";
import { STEPS } from "../chart/palette";
import "./sunburst.css";

export type SunNode = { label: string; value?: number; children?: SunNode[] };
export type SunburstProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  data: SunNode;
  size?: number;
  format?: (v: number) => string;
};

type Arc = { node: SunNode; path: string[]; depth: number; a0: number; a1: number; value: number };

const valueOf = (n: SunNode): number => n.value ?? (n.children ?? []).reduce((a, c) => a + valueOf(c), 0);

export function Sunburst({ data, size = 240, format = compact, ...frame }: SunburstProps) {
  const [hot, setHot] = useState<string[] | null>(null);
  const total = valueOf(data);
  const arcs = useMemo(() => {
    const out: Arc[] = [];
    const walk = (n: SunNode, path: string[], depth: number, a0: number, a1: number) => {
      let a = a0;
      for (const c of n.children ?? []) {
        const v = valueOf(c);
        const span = ((a1 - a0) * v) / valueOf(n);
        out.push({ node: c, path: [...path, c.label], depth, a0: a, a1: a + span, value: v });
        walk(c, [...path, c.label], depth + 1, a, a + span);
        a += span;
      }
    };
    walk(data, [], 1, 0, Math.PI * 2);
    return out;
  }, [data]);
  const depth = Math.max(...arcs.map((a) => a.depth));
  const r = size / 2;
  const ring = (r - r * 0.32) / depth;
  const inner = r * 0.32;
  const onPath = (a: Arc) => !hot || (a.path.length <= hot.length && a.path.every((p, i) => p === hot[i]));
  const step = (d: number) => STEPS[Math.min(STEPS.length - 1, (d - 1) * 2)];
  const focus = hot ? arcs.find((a) => a.path.join("/") === hot.join("/")) : null;
  const gap = 1.5 / r;
  return (
    <ChartFrame {...frame} table={{ columns: ["Path", "Value", "Share"], rows: arcs.map((a) => [a.path.join(" › "), a.value, `${((a.value / total) * 100).toFixed(1)}%`]) }}>
      <div className="l-sun" onPointerLeave={() => setHot(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${frame.title}: ${(data.children ?? []).map((c) => `${c.label} ${((valueOf(c) / total) * 100).toFixed(0)}%`).join(", ")}`}>
          {arcs.map((a, i) => (
            <path
              key={a.path.join("/")}
              className="l-viz-mark l-sun__arc"
              style={{ animationDelay: `${a.depth * 90 + i * 8}ms` }}
              d={arcPath(r, r, inner + (a.depth - 1) * ring + 1, inner + a.depth * ring - 1, a.a0 + gap, Math.max(a.a0 + gap, a.a1 - gap))}
              fill={onPath(a) ? step(a.depth) : "var(--l-viz-mid)"}
              tabIndex={0}
              aria-label={`${a.path.join(", ")}: ${format(a.value)}`}
              onPointerEnter={() => setHot(a.path)}
              onFocus={() => setHot(a.path)}
              onBlur={() => setHot(null)}
            />
          ))}
        </svg>
        <div className="l-sun__center" aria-hidden>
          <b key={focus?.path.join("/") ?? "all"}>{focus ? `${((focus.value / total) * 100).toFixed(0)}%` : format(total)}</b>
          <span key={`l${focus?.path.join("/") ?? "all"}`}>{focus ? focus.path.join(" › ") : data.label}</span>
        </div>
      </div>
    </ChartFrame>
  );
}
