/*
  Liner · Gauge
  One value against its range, as a meter. The fill says how severe: the accent while all is
  well, warning past one threshold, danger past the next; the track is a lighter step of the
  same tone, so state reads across the whole arc. Words carry the state as well.
*/
import { cx } from "../../lib/hooks";
import { arcPath } from "../chart/scale";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./gauge.css";

export type GaugeProps = {
  value: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  /** Where warning and danger start. */
  thresholds?: [number, number];
  /** Higher is worse (load, latency) or better (score). */
  higherIs?: "worse" | "better";
  size?: number;
  className?: string;
};

export function Gauge({ value, min = 0, max = 100, label, unit = "", thresholds, higherIs = "worse", size = 200, className }: GaugeProps) {
  const f = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const [warnAt, dangerAt] = thresholds ?? (higherIs === "worse" ? [max * 0.7, max * 0.9] : [max * 0.5, max * 0.3]);
  const state = higherIs === "worse" ? (value >= dangerAt ? "danger" : value >= warnAt ? "warn" : "ok") : value <= dangerAt ? "danger" : value <= warnAt ? "warn" : "ok";
  const words = { ok: "Healthy", warn: "Elevated", danger: "Critical" }[state];
  const r = size / 2;
  const a0 = -Math.PI * 0.75;
  const a1 = Math.PI * 0.75;
  const track = arcPath(r, r, r - 14, r, a0, a1);
  // The fill grows by angle; a CSS transition on the clip carries it.
  const sweep = (a1 - a0) * f;
  return (
    <div className={cx("l-gauge", className)} data-state={state} role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}${unit} of ${max}${unit}, ${words}`}>
      <svg width={size} height={size * 0.86} viewBox={`0 0 ${size} ${size * 0.86}`} aria-hidden>
        <path d={track} className="l-gauge__track" />
        <path d={arcPath(r, r, r - 14, r, a0, a0 + Math.max(0.001, sweep))} className="l-gauge__fill" />
        {[warnAt, dangerAt].map((t) => {
          const a = a0 + (a1 - a0) * ((t - min) / (max - min));
          return <line key={t} x1={r + (r - 18) * Math.sin(a)} y1={r - (r - 18) * Math.cos(a)} x2={r + (r + 2) * Math.sin(a)} y2={r - (r + 2) * Math.cos(a)} className="l-gauge__tick" />;
        })}
      </svg>
      <div className="l-gauge__read">
        <b>
          <RollingNumber value={value} />
          <small>{unit}</small>
        </b>
        <span className="l-gauge__state" key={state}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            {state === "ok" ? <path d="M4 8.4 6.8 11 12 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M8 4.5v4.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}
          </svg>
          {words}
        </span>
        <span className="l-gauge__label">{label}</span>
      </div>
    </div>
  );
}
