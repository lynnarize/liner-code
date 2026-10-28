/*
  Liner · Chart frame
  What every chart sits in: a glass frame around a white card with the title, the legend
  and the plot, and a quiet strip that switches to a table of the same numbers. The table
  is not an extra: it is how every value stays reachable without hovering.
  ChartTip is the one tooltip all charts share: values lead, names follow, keyed by a short
  stroke of the series color.
*/
import { useId, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./chart.css";

export type LegendItem = { label: string; color: string; kind?: "line" | "rect"; muted?: boolean };
export type ChartTable = { columns: string[]; rows: (string | number)[][] };

export type ChartFrameProps = {
  title: string;
  subtitle?: ReactNode;
  /** A big number for the header, like the latest value. */
  figure?: ReactNode;
  legend?: LegendItem[];
  table?: ChartTable;
  /** Controls for the strip, like a range switch. */
  actions?: ReactNode;
  onLegendHover?: (label: string | null) => void;
  children: ReactNode;
  className?: string;
};

export function ChartFrame({ title, subtitle, figure, legend, table, actions, onLegendHover, children, className }: ChartFrameProps) {
  const id = useId();
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <figure className={cx("l-viz l-frame", className)} aria-labelledby={`${id}-t`}>
      <div className="l-frame-card l-viz__card">
        <header className="l-viz__head">
          <div className="l-viz__titles">
            <figcaption id={`${id}-t`} className="l-viz__title">
              {title}
            </figcaption>
            {subtitle && <span className="l-viz__sub">{subtitle}</span>}
          </div>
          {figure && <div className="l-viz__figure">{figure}</div>}
        </header>
        {legend && legend.length > 1 && view === "chart" && (
          <ul className="l-viz__legend" aria-label="Legend">
            {legend.map((l) => (
              <li key={l.label} data-muted={l.muted || undefined} onPointerEnter={() => onLegendHover?.(l.label)} onPointerLeave={() => onLegendHover?.(null)}>
                <i data-kind={l.kind ?? "rect"} style={{ background: l.color }} aria-hidden />
                {l.label}
              </li>
            ))}
          </ul>
        )}
        {view === "chart" ? (
          <div className="l-viz__plot">{children}</div>
        ) : (
          table && (
            <div className="l-viz__table" key="table">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{typeof c === "number" ? c.toLocaleString("en-US") : c}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      {(table || actions) && (
        <div className="l-frame-strip l-viz__strip">
          <span className="l-viz__actions">{actions}</span>
          {table && (
            <span className="l-viz__views" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                Chart
              </button>
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
                Table
              </button>
            </span>
          )}
        </div>
      )}
    </figure>
  );
}

export type TipRow = { label: string; value: string; color?: string; kind?: "line" | "rect" };

/** The shared tooltip. Place it inside a relative plot; x and y are in plot pixels. */
export function ChartTip({ x, y, title, rows, width, align }: { x: number; y: number; title?: string; rows: TipRow[]; width: number; align?: "above" | "side" }) {
  // Flip to the other side of the pointer near the right edge.
  const left = x > width * 0.62;
  return (
    <div className="l-viz-tip l-glass" data-side={left ? "left" : "right"} data-align={align ?? "side"} style={{ left: x, top: y }} role="presentation">
      {title && <div className="l-viz-tip__title">{title}</div>}
      {rows.map((r) => (
        <div key={r.label} className="l-viz-tip__row">
          {r.color && <i data-kind={r.kind ?? "line"} style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal gridlines with their tick labels, recessive by design. */
export function GridY({ ticks, y, x0, x1, format = String }: { ticks: number[]; y: (v: number) => number; x0: number; x1: number; format?: (v: number) => string }) {
  return (
    <g className="l-viz__grid" aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} data-zero={t === 0 || undefined} />
          <text x={x0 - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}
