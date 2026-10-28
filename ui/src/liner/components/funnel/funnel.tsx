/*
  Liner · Funnel
  How many make it from each step to the next. Stages are ordered, so they take the
  accent's steps from light to dark as people go deeper; between stages, the share that
  carried on is said in words.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { compact } from "../chart/scale";
import { STEPS } from "../chart/palette";
import "./funnel.css";

export type FunnelStage = { label: string; value: number };
export type FunnelProps = Omit<ChartFrameProps, "children" | "legend" | "table"> & {
  stages: FunnelStage[];
  format?: (v: number) => string;
};

export function Funnel({ stages, format = compact, ...frame }: FunnelProps) {
  const [hot, setHot] = useState<number | null>(null);
  const top = stages[0].value;
  const color = (i: number) => STEPS[Math.round((i / Math.max(1, stages.length - 1)) * (STEPS.length - 1))];
  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%`;
  return (
    <ChartFrame
      {...frame}
      figure={frame.figure ?? pct(stages[stages.length - 1].value, top)}
      table={{ columns: ["Stage", "People", "Of start", "From previous"], rows: stages.map((s, i) => [s.label, s.value, pct(s.value, top), i ? pct(s.value, stages[i - 1].value) : "–"]) }}
    >
      <ol className="l-funnel" aria-label={frame.title}>
        {stages.map((s, i) => (
          <li key={s.label} className={cx("l-funnel__stage", hot !== null && hot !== i && "is-dim")} onPointerEnter={() => setHot(i)} onPointerLeave={() => setHot(null)}>
            {i > 0 && (
              <span className="l-funnel__step" aria-label={`${pct(s.value, stages[i - 1].value)} continued`}>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 3.5v9m0 0-3.5-3.5M8 12.5l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {pct(s.value, stages[i - 1].value)}
              </span>
            )}
            <div className="l-funnel__row">
              <span className="l-funnel__label">{s.label}</span>
              <span className="l-funnel__track">
                <span className="l-funnel__bar" style={{ width: `${(s.value / top) * 100}%`, background: color(i), animationDelay: `${i * 80}ms` }} />
              </span>
              <span className="l-funnel__value">
                <b>{format(s.value)}</b>
                <em>{pct(s.value, top)}</em>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </ChartFrame>
  );
}
