/*
  Liner · Metric card
  One number with its context: what it is, how it moved against a named period, and the
  trend behind it. The value rolls when it changes; the delta's color says whether the
  move is good, with an arrow so color never carries it alone.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import { Sparkline } from "../sparkline/sparkline";
import "./metric-card.css";

export type MetricCardProps = {
  label: string;
  value: number;
  format?: Intl.NumberFormatOptions;
  /** Change as a fraction, like 0.124 for +12.4%. */
  delta?: number;
  /** Named period the delta compares with. */
  period?: string;
  /** Whether a rise is good (revenue) or bad (churn). */
  goodWhen?: "up" | "down";
  trend?: number[];
  trendLabels?: string[];
  icon?: ReactNode;
  className?: string;
};

export function MetricCard({ label, value, format, delta, period = "vs last period", goodWhen = "up", trend, trendLabels, icon, className }: MetricCardProps) {
  const dir = delta === undefined || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good = dir === "flat" ? undefined : dir === goodWhen;
  const fmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, ...format });
  return (
    <div className={cx("l-metric l-frame-solo", className)}>
      <div className="l-metric__label">
        {icon && <span className="l-metric__icon">{icon}</span>}
        {label}
      </div>
      <div className="l-metric__value">
        <RollingNumber value={value} format={{ notation: "compact", maximumFractionDigits: 1, ...format }} />
      </div>
      {delta !== undefined && (
        <div className="l-metric__delta" data-good={good === undefined ? undefined : String(good)} aria-label={`${dir === "flat" ? "No change" : `${dir === "up" ? "Up" : "Down"} ${Math.abs(delta * 100).toFixed(1)}%`} ${period}`}>
          <span className="l-metric__chip" aria-hidden>
            <svg viewBox="0 0 16 16" fill="none" data-dir={dir}>
              {dir === "flat" ? <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
          <span className="l-metric__period" aria-hidden>
            {period}
          </span>
        </div>
      )}
      {trend && (
        <div className="l-metric__trend">
          <Sparkline data={trend} labels={trendLabels} label={`${label} trend`} format={(v) => fmt.format(v)} height={40} />
        </div>
      )}
    </div>
  );
}
