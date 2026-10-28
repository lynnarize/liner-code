/*
  Liner · Activity heatmap
  A year of days as squares, darker where more happened. Five validated steps of the accent
  carry the amount, and a scale says what they mean. Point at a day, or walk the grid with
  the arrow keys, to read it exactly.
*/
import { useMemo, useState, type KeyboardEvent } from "react";
import { cx, useSize } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { STEPS } from "../chart/palette";
import "./activity-heatmap.css";

export type ActivityHeatmapProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  /** Counts per day, oldest first, ending today. */
  days: number[];
  end?: Date;
  noun?: [string, string];
};

export function ActivityHeatmap({ days, end = new Date(), noun = ["contribution", "contributions"], ...frame }: ActivityHeatmapProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const [focus, setFocus] = useState(days.length - 1);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days.length - 1));
  const lead = start.getDay(); // Sunday-first columns
  const max = Math.max(1, ...days);
  // Quantile-ish buckets so a few busy days don't wash the rest out.
  const level = (n: number) => (n === 0 ? -1 : Math.min(4, Math.floor((n / max) * 5)));
  const date = (i: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const weeks = Math.ceil((days.length + lead) / 7);
  const cell = Math.max(8, Math.min(14, Math.floor(((size?.width ?? 600) - 30) / weeks) - 3));
  const months = useMemo(() => {
    const out: { col: number; label: string }[] = [];
    let last = -1;
    for (let i = 0; i < days.length; i++) {
      const d = date(i);
      if (d.getDate() <= 7 && d.getMonth() !== last && d.getDay() === 0) {
        out.push({ col: Math.floor((i + lead) / 7), label: d.toLocaleString("en-US", { month: "short" }) });
        last = d.getMonth();
      }
    }
    return out;
  }, [days.length, end.toDateString()]);
  const total = days.reduce((a, b) => a + b, 0);
  const shown = at ?? null;
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(days.length - 1, focus + d));
    setFocus(next);
    setAt(next);
  };
  return (
    <ChartFrame
      {...frame}
      figure={frame.figure ?? total.toLocaleString("en-US")}
      table={{ columns: ["Week of", "Total"], rows: Array.from({ length: weeks }, (_, w) => [fmt.format(date(Math.max(0, w * 7 - lead))), days.slice(Math.max(0, w * 7 - lead), w * 7 - lead + 7).reduce((a, b) => a + b, 0)]) }}
    >
      <div ref={ref} className="l-heat" style={{ ["--cell" as string]: `${cell}px` }}>
        <div className="l-heat__months" aria-hidden style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}>
          {months.map((m) => (
            <span key={`${m.col}${m.label}`} style={{ gridColumn: m.col + 1 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="l-heat__body">
          <div className="l-heat__days" aria-hidden>
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div
            className="l-heat__grid"
            role="grid"
            aria-label={`${frame.title}. Use the arrow keys to read days.`}
            tabIndex={0}
            onKeyDown={onKey}
            onFocus={() => setAt(focus)}
            onBlur={() => setAt(null)}
            style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}
            onPointerLeave={() => setAt(null)}
          >
            {Array.from({ length: lead }, (_, i) => (
              <i key={`p${i}`} aria-hidden />
            ))}
            {days.map((n, i) => {
              const l = level(n);
              return <i key={i} className={cx("l-heat__cell", i === shown && "is-on")} style={{ background: l < 0 ? "var(--l-wash-2)" : STEPS[l] }} onPointerEnter={() => setAt(i)} />;
            })}
          </div>
        </div>
        <div className="l-heat__foot">
          <span className="l-heat__read" aria-live="polite" key={shown ?? "none"}>
            {shown !== null ? (
              <>
                <b>
                  {days[shown]} {days[shown] === 1 ? noun[0] : noun[1]}
                </b>{" "}
                on {fmt.format(date(shown))}
              </>
            ) : (
              "Point at a day to read it"
            )}
          </span>
          <span className="l-heat__scale" aria-label="Less to more">
            Less
            {["var(--l-wash-2)", ...STEPS].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
            More
          </span>
        </div>
      </div>
    </ChartFrame>
  );
}
