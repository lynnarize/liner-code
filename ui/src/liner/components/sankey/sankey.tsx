/*
  Liner · Sankey flow
  Where things go: sources on the left, outcomes on the right, each flow as wide as what it
  carries. Flows rest as a faint wash; point at a node or a flow and its paths light in the
  accent while everything else steps back.
*/
import { useMemo, useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, type ChartFrameProps } from "../chart/chart";
import { compact } from "../chart/scale";

export type SankeyNode = { id: string; label: string; column: number };
export type SankeyLink = { from: string; to: string; value: number };
export type SankeyProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  nodes: SankeyNode[];
  links: SankeyLink[];
  height?: number;
  format?: (v: number) => string;
};

export function Sankey({ nodes, links, height = 280, format = compact, ...frame }: SankeyProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hot, setHot] = useState<{ node?: string; link?: number } | null>(null);
  const w = size?.width ?? 0;
  const layout = useMemo(() => {
    const cols = Math.max(...nodes.map((n) => n.column)) + 1;
    const through = (id: string) => Math.max(links.filter((l) => l.from === id).reduce((a, l) => a + l.value, 0), links.filter((l) => l.to === id).reduce((a, l) => a + l.value, 0));
    const pad = 14;
    const colTotals = Array.from({ length: cols }, (_, c) => nodes.filter((n) => n.column === c).reduce((a, n) => a + through(n.id), 0));
    const colCounts = Array.from({ length: cols }, (_, c) => nodes.filter((n) => n.column === c).length);
    const k = Math.min(...colTotals.map((t, c) => (height - pad * (colCounts[c] - 1)) / t));
    const nodeW = 10;
    const x = (c: number) => (c / (cols - 1)) * (w - nodeW);
    const pos = new Map<string, { x: number; y: number; h: number; outY: number; inY: number }>();
    for (let c = 0; c < cols; c++) {
      const col = nodes.filter((n) => n.column === c);
      const used = col.reduce((a, n) => a + through(n.id) * k, 0) + pad * (col.length - 1);
      let y = (height - used) / 2;
      for (const n of col) {
        const h = through(n.id) * k;
        pos.set(n.id, { x: x(c), y, h, outY: y, inY: y });
        y += h + pad;
      }
    }
    const paths = links.map((l) => {
      const a = pos.get(l.from)!;
      const b = pos.get(l.to)!;
      const t = l.value * k;
      const y0 = a.outY + t / 2;
      const y1 = b.inY + t / 2;
      a.outY += t;
      b.inY += t;
      const x0 = a.x + nodeW;
      const x1 = b.x;
      const mx = (x0 + x1) / 2;
      return { d: `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`, t, mid: { x: mx, y: (y0 + y1) / 2 } };
    });
    return { pos, paths, nodeW, through };
  }, [nodes, links, w, height]);

  const linkOn = (i: number) => !hot || hot.link === i || (hot.node !== undefined && (links[i].from === hot.node || links[i].to === hot.node));
  return (
    <ChartFrame {...frame} table={{ columns: ["From", "To", "Value"], rows: links.map((l) => [nodes.find((n) => n.id === l.from)!.label, nodes.find((n) => n.id === l.to)!.label, l.value]) }}>
      <div ref={ref} className="l-viz-hit" style={{ height: height + 8 }} role="img" aria-label={`${frame.title}: ${links.map((l) => `${l.from} to ${l.to} ${format(l.value)}`).join(", ")}`} onPointerLeave={() => setHot(null)}>
        {w > 0 && (
          <svg width={w} height={height + 8} viewBox={`0 0 ${w} ${height + 8}`} aria-hidden>
            {layout.paths.map((p, i) => (
              <path
                key={i}
                className="l-viz-mark l-viz-fade"
                d={p.d}
                fill="none"
                stroke={hot && linkOn(i) ? "var(--l-accent)" : "var(--l-viz-gray)"}
                strokeOpacity={hot ? (linkOn(i) ? 0.55 : 0.12) : 0.32}
                strokeWidth={Math.max(1, p.t - 1.5)}
                onPointerEnter={() => setHot({ link: i })}
              />
            ))}
            {nodes.map((n) => {
              const p = layout.pos.get(n.id)!;
              const last = p.x > w / 2;
              return (
                <g key={n.id} onPointerEnter={() => setHot({ node: n.id })}>
                  <rect x={p.x} y={p.y} width={layout.nodeW} height={Math.max(2, p.h)} rx={3} fill={hot?.node === n.id ? "var(--l-accent)" : "var(--l-ink-2)"} className="l-viz-mark" />
                  <text className="l-viz-label" x={last ? p.x - 8 : p.x + layout.nodeW + 8} y={p.y + p.h / 2 - 6} dy="0.32em" textAnchor={last ? "end" : "start"}>
                    {n.label}
                  </text>
                  <text x={last ? p.x - 8 : p.x + layout.nodeW + 8} y={p.y + p.h / 2 + 8} dy="0.32em" textAnchor={last ? "end" : "start"}>
                    {format(layout.through(n.id))}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hot?.link !== undefined && w > 0 && (
          <ChartTip
            x={layout.paths[hot.link].mid.x}
            y={layout.paths[hot.link].mid.y}
            width={w}
            rows={[{ label: `${nodes.find((n) => n.id === links[hot.link!].from)!.label} → ${nodes.find((n) => n.id === links[hot.link!].to)!.label}`, value: format(links[hot.link].value), color: "var(--l-accent)" }]}
          />
        )}
      </div>
    </ChartFrame>
  );
}
