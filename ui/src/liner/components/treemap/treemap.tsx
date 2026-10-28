/*
  Liner · Treemap
  Part to whole when there are many parts in groups: area is value. Tiles are one soft step
  of the accent (they are one series), separated by a sliver of surface; groups are named
  above their tiles. Pointing at a tile lifts it to the full accent and reads it.
*/
import { useMemo, useState } from "react";
import { useSize } from "../../lib/hooks";
import { ChartFrame, ChartTip, type ChartFrameProps } from "../chart/chart";
import { compact } from "../chart/scale";
import { squarify } from "../chart/squarify";

export type TreemapGroup = { label: string; items: { label: string; value: number }[] };
export type TreemapProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  groups: TreemapGroup[];
  height?: number;
  format?: (v: number) => string;
};

export function Treemap({ groups, height = 280, format = compact, ...frame }: TreemapProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hot, setHot] = useState<string | null>(null);
  const w = size?.width ?? 0;
  const total = groups.reduce((a, g) => a + g.items.reduce((s, i) => s + i.value, 0), 0);
  const layout = useMemo(() => {
    const gs = squarify(
      groups.map((g) => ({ ...g, value: g.items.reduce((s, i) => s + i.value, 0) })),
      { x: 0, y: 0, w, h: height },
    );
    return gs.map((g) => ({ ...g, tiles: squarify(g.items.map((i) => ({ ...i, group: g.label })), { x: g.x + 2, y: g.y + 20, w: g.w - 4, h: g.h - 22 }) }));
  }, [groups, w, height]);
  const tile = hot ? layout.flatMap((g) => g.tiles).find((t) => `${t.group}/${t.label}` === hot) : null;
  return (
    <ChartFrame {...frame} table={{ columns: ["Group", "Item", "Value", "Share"], rows: groups.flatMap((g) => g.items.map((i) => [g.label, i.label, i.value, `${((i.value / total) * 100).toFixed(1)}%`])) }}>
      <div ref={ref} className="l-viz-hit" style={{ height }} role="img" aria-label={`${frame.title}: ${groups.map((g) => g.label).join(", ")}`} onPointerLeave={() => setHot(null)}>
        {w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
            {layout.map((g) => (
              <g key={g.label}>
                {g.w > 40 && (
                  <text className="l-viz-label" x={g.x + 4} y={g.y + 13}>
                    {g.label} <tspan style={{ fill: "var(--l-ink-3)", fontWeight: 400 }}>{format(g.value)}</tspan>
                  </text>
                )}
                {g.tiles.map((t, i) => {
                  const id = `${t.group}/${t.label}`;
                  const on = hot === id;
                  const fits = t.w > 54 && t.h > 30;
                  return (
                    <g key={id} onPointerEnter={() => setHot(id)} className="l-viz-fade" style={{ animationDelay: `${i * 30}ms` }}>
                      <rect className="l-viz-mark" x={t.x + 1} y={t.y + 1} width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)} rx={6} fill={on ? "var(--l-accent)" : "color-mix(in oklab, var(--l-accent) 18%, var(--l-card-fill))"} />
                      {fits && (
                        <>
                          <text x={t.x + 9} y={t.y + 18} style={{ fill: on ? "var(--l-accent-ink)" : "var(--l-ink)", fontSize: 11.5, fontWeight: 600 }}>
                            {t.label}
                          </text>
                          <text x={t.x + 9} y={t.y + 32} style={{ fill: on ? "var(--l-accent-ink)" : "var(--l-ink-3)", fontSize: 11 }}>
                            {format(t.value)}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        )}
        {tile && w > 0 && (
          <ChartTip
            x={tile.x + tile.w / 2}
            y={tile.y + tile.h / 2}
            width={w}
            title={tile.group}
            rows={[
              { label: tile.label, value: format(tile.value), color: "var(--l-accent)", kind: "rect" },
              { label: "of total", value: `${((tile.value / total) * 100).toFixed(1)}%` },
            ]}
          />
        )}
      </div>
    </ChartFrame>
  );
}
