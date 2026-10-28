/*
  Liner · Meter
  One amount against its limit, small enough to sit three in a row: a name, the value of
  the cap, and a thin bar. Near the cap a dot appears and the bar turns amber; at the cap
  it turns red. The value rolls and the bar springs when it changes.
*/
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./meter.css";

export type MeterProps = {
  label: string;
  value: number;
  max: number;
  unit?: string;
  format?: Intl.NumberFormatOptions;
  /** Fraction of the cap where the warning starts. */
  warnAt?: number;
  className?: string;
};

export function Meter({ label, value, max, unit, format = { maximumFractionDigits: 1 }, warnAt = 0.8, className }: MeterProps) {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const state = frac >= 1 ? "full" : frac >= warnAt ? "warn" : "ok";
  const fmt = (n: number) => new Intl.NumberFormat("en-US", format).format(n);
  const text = `${fmt(value)} of ${fmt(max)}${unit ? ` ${unit}` : ""}${state === "full" ? ", at the limit" : state === "warn" ? ", nearly full" : ""}`;
  return (
    <div className={cx("l-meter", className)} data-state={state}>
      <div className="l-meter__label">
        {label}
        {state !== "ok" && <i className="l-meter__dot" aria-hidden />}
      </div>
      <div className="l-meter__value">
        <b className="l-num">
          <RollingNumber value={value} format={format} />
        </b>
        <span>
          {" "}
          of {fmt(max)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="l-meter__bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text}>
        <i style={{ transform: `scaleX(${frac})` }} />
      </div>
    </div>
  );
}
