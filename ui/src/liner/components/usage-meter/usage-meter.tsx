/*
  Liner · Usage meter
  How much of a limit is used, and by what. One bar split into parts in shades of ink, a
  legend that reads like a receipt, and a quiet warning as you near the cap.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./usage-meter.css";

export type UsagePart = { label: string; value: number };
export type UsageMeterProps = {
  label: string;
  parts: UsagePart[];
  limit: number;
  unit?: string;
  /** Fraction of the limit where the warning starts. */
  warnAt?: number;
  /** A line under the legend, like an upgrade link. */
  footer?: ReactNode;
  className?: string;
};

export function UsageMeter({ label, parts, limit, unit = "", warnAt = 0.85, footer, className }: UsageMeterProps) {
  const used = parts.reduce((a, p) => a + p.value, 0);
  const frac = Math.min(1, used / limit);
  const state = frac >= 1 ? "full" : frac >= warnAt ? "warn" : "ok";
  const fmt = (n: number) => `${Number(n.toFixed(1))}${unit ? ` ${unit}` : ""}`;
  return (
    <div className={cx("l-usage l-frame-solo", className)} data-state={state}>
      <div className="l-usage__head">
        <span className="l-usage__label">{label}</span>
        <span className="l-usage__total">
          <RollingNumber value={Number(used.toFixed(1))} format={{ maximumFractionDigits: 1 }} />
          <span>
            {" "}
            of {fmt(limit)}
          </span>
        </span>
      </div>
      <div className="l-usage__bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-valuetext={`${fmt(used)} of ${fmt(limit)}`}>
        {parts.map((p, i) => (
          <span key={p.label} className="l-usage__seg" data-i={i} style={{ flexGrow: p.value / limit, transitionDelay: `${i * 60}ms` }} />
        ))}
        <span className="l-usage__rest" style={{ flexGrow: Math.max(0, 1 - frac) }} />
      </div>
      <ul className="l-usage__legend">
        {parts.map((p, i) => (
          <li key={p.label}>
            <i data-i={i} aria-hidden />
            <span>{p.label}</span>
            <b>{fmt(p.value)}</b>
          </li>
        ))}
      </ul>
      {(state !== "ok" || footer) && (
        <div className="l-usage__foot" key={state}>
          {state === "full" ? "You've reached the limit." : state === "warn" ? `${Math.round(frac * 100)}% used: nearly full.` : null} {footer}
        </div>
      )}
    </div>
  );
}
