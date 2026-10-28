/*
  Liner · Badge and Count
  A short label that classifies. Neutral by default; tones are for status only and keep
  their text in ink-tinted color, not a bright fill. Count is a number badge that rolls and
  pops when it changes.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./badge.css";

export type BadgeProps = {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  variant?: "soft" | "outline" | "solid";
  icon?: ReactNode;
  /** A status dot before the label; `pulse` rings it a few times, for something live. */
  dot?: boolean;
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export function Badge({ children, tone = "neutral", variant = "soft", icon, dot, pulse, size = "md", className }: BadgeProps) {
  return (
    <span className={cx("l-badge", className)} data-tone={tone} data-variant={variant} data-size={size}>
      {dot && <span className="l-badge__dot" data-pulse={pulse || undefined} aria-hidden />}
      {icon && <span className="l-badge__icon">{icon}</span>}
      {children}
    </span>
  );
}

export function Count({ value, max = 99, className, label }: { value: number; max?: number; className?: string; label?: string }) {
  const [pop, setPop] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (value > prev.current) setPop((p) => p + 1);
    prev.current = value;
  }, [value]);
  if (value <= 0) return null;
  return (
    <span className={cx("l-count-badge", className)} key={pop} data-pop={pop > 0 || undefined} aria-label={label ? `${value} ${label}` : String(value)}>
      {value > max ? `${max}+` : <RollingNumber value={value} />}
    </span>
  );
}
