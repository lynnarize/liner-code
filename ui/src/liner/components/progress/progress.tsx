/*
  Liner · Progress
  How far along something is. The bar eases to each new value and its percentage rolls;
  without a value it becomes a calm sweep. ProgressRing is the same idea around a circle.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./progress.css";

export type ProgressProps = {
  /** 0 to 1. Leave out for an indeterminate sweep. */
  value?: number;
  label?: string;
  /** Show the percentage after the label. */
  showValue?: boolean;
  size?: "sm" | "md";
  tone?: "ink" | "accent";
  className?: string;
};

export function Progress({ value, label, showValue = true, size = "md", tone = "ink", className }: ProgressProps) {
  const known = value !== undefined;
  const v = known ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div className={cx("l-progress", className)} data-size={size} data-tone={tone} data-done={(known && v >= 1) || undefined}>
      {(label || (showValue && known)) && (
        <div className="l-progress__head">
          {label && <span>{label}</span>}
          {showValue && known && <RollingNumber value={Math.round(v * 100)} format={{ style: "unit", unit: "percent" }} className="l-progress__pct" />}
        </div>
      )}
      <div
        className="l-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(v * 100) : undefined}
        data-indeterminate={!known || undefined}
      >
        <span className="l-progress__fill" style={known ? { transform: `scaleX(${v})` } : undefined} />
      </div>
    </div>
  );
}

export type ProgressRingProps = { value: number; size?: number; stroke?: number; label?: string; children?: ReactNode; className?: string };

export function ProgressRing({ value, size = 56, stroke = 5, label, children, className }: ProgressRingProps) {
  const v = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cx("l-ring", className)} style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} data-done={v >= 1 || undefined}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="l-ring__track" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="l-ring__fill" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - v) }} />
      </svg>
      <span className="l-ring__center">{children ?? <RollingNumber value={Math.round(v * 100)} format={{ style: "unit", unit: "percent" }} />}</span>
    </span>
  );
}
