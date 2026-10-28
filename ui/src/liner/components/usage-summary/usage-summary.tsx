/*
  Liner · Usage summary
  Where a period stands, and where it is heading. The big number against the allowance;
  one bar split by what used it, with a notch where an even pace would be today and a
  dashed run to where this pace ends up. The line under it says it plainly: within the
  limit, or how far over. A second column can explain the trend; the strip says what is
  left and holds the one action. Parts take the accent ramp, strongest first.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./usage-summary.css";

export type UsageSummaryPart = { label: string; value: number };
export type UsageSummaryProps = {
  title: string;
  meta?: ReactNode;
  parts: UsageSummaryPart[];
  limit: number;
  /** What is counted, like "minutes". */
  noun?: string;
  /** How much of the period has gone, 0 to 1. With it, the bar shows the pace. */
  elapsed?: number;
  /** The period's last day, for the pace line, like "Nov 1". */
  periodEnd?: string;
  /** A second column. */
  aside?: ReactNode;
  /** The strip's left side; by default, what is left. */
  note?: ReactNode;
  /** The strip's right side, like an upgrade button. */
  action?: ReactNode;
  className?: string;
};

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const pc = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`;

export function UsageSummary({ title, meta, parts, limit, noun = "", elapsed, periodEnd, aside, note, action, className }: UsageSummaryProps) {
  const used = parts.reduce((a, p) => a + p.value, 0);
  const paced = elapsed !== undefined && elapsed > 0;
  const projected = paced ? used / Math.min(1, Math.max(elapsed, 0.02)) : used;
  // The bar's full width is the limit, or the projection when it runs past it.
  const scale = Math.max(limit, used, paced ? projected : 0) || 1;
  const over = paced ? projected > limit : used > limit;
  const state = used >= limit ? "full" : over ? "warn" : "ok";
  const left = Math.max(0, limit - used);
  const unit = noun ? ` ${noun}` : "";
  const pace = paced
    ? over
      ? `At this pace, ${n(projected)}${unit} by ${periodEnd ?? "the end"}: ${Math.round((projected / limit - 1) * 100)}% over the limit.`
      : `At this pace, ${n(projected)}${unit} by ${periodEnd ?? "the end"}, inside the limit.`
    : null;

  return (
    <section className={cx("l-usum l-frame", className)} data-state={state} aria-label={title}>
      <div className="l-frame-card l-usum__card" data-aside={aside ? "" : undefined}>
        <div className="l-usum__main">
          <header className="l-usum__head">
            <b>{title}</b>
            {meta && <span>{meta}</span>}
          </header>
          <div className="l-usum__figure">
            <span className="l-usum__used l-num">
              <RollingNumber value={used} />
            </span>
            <span className="l-usum__of">
              of {n(limit)}
              {unit}
            </span>
            <span className="l-usum__pct l-num">
              <RollingNumber value={Math.round((used / limit) * 100)} />%
            </span>
          </div>
          <div className="l-usum__bar" role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-valuetext={`${n(used)} of ${n(limit)}${unit}${pace ? `. ${pace}` : ""}`}>
            <div className="l-usum__fill">
              {parts.map((p, i) => (
                <span key={p.label} className="l-usum__seg" data-i={Math.min(i, 3)} style={{ width: pc(p.value / scale), animationDelay: `${120 + i * 70}ms` }} />
              ))}
            </div>
            {paced && projected > used && <span className="l-usum__proj" data-over={over || undefined} style={{ left: pc(used / scale), width: pc((projected - used) / scale) }} />}
            {scale > limit && <span className="l-usum__limit" style={{ left: pc(limit / scale) }} />}
            {paced && <span className="l-usum__even" style={{ left: pc((Math.min(elapsed, 1) * limit) / scale) }} />}
          </div>
          {pace && (
            <p className="l-usum__pace" key={pace}>
              {pace}
            </p>
          )}
          <ul className="l-usum__legend">
            {parts.map((p, i) => (
              <li key={p.label}>
                <i data-i={Math.min(i, 3)} aria-hidden />
                <span>{p.label}</span>
                <b className="l-num">{n(p.value)}</b>
              </li>
            ))}
          </ul>
        </div>
        {aside && <div className="l-usum__aside">{aside}</div>}
      </div>
      {(note !== null || action) && (
        <div className="l-frame-strip l-usum__strip">
          <span className="l-usum__note" key={state}>
            {note ?? (state === "full" ? `Every one of this period's ${noun || "units"} is used` : `${n(left)}${unit} left`)}
          </span>
          {action}
        </div>
      )}
    </section>
  );
}
