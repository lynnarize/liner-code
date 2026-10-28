/*
  Liner · Countdown
  Time left until a moment, in rolling digits. Units that have run out drop away from the
  front, so “2 days” becomes “23 hours” without a row of zeros, and the end says so.
*/
import { useEffect, useState } from "react";
import { cx } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./countdown.css";

export type CountdownProps = {
  to: Date;
  /** Shown when the time is up. */
  done?: string;
  onDone?: () => void;
  size?: "md" | "lg";
  className?: string;
};

const UNITS = [
  ["days", 86400],
  ["hours", 3600],
  ["minutes", 60],
  ["seconds", 1],
] as const;

export function Countdown({ to, done = "It's time", onDone, size = "md", className }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.floor((to.getTime() - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    // Tick on the second boundary so digits change together.
    const t = window.setTimeout(() => setNow(Date.now()), 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(t);
  }, [now, left]);
  useEffect(() => {
    if (left === 0) onDone?.();
  }, [left === 0]);

  let rest = left;
  const parts = UNITS.map(([name, s]) => {
    const n = Math.floor(rest / s);
    rest -= n * s;
    return { name, n };
  });
  const first = parts.findIndex((p) => p.n > 0);
  const shown = parts.slice(Math.max(0, Math.min(first, 2)));
  const label = shown.map((p) => `${p.n} ${p.name}`).join(", ");

  if (left === 0)
    return (
      <div className={cx("l-count", className)} data-size={size} data-done="" role="timer">
        <span className="l-count__done">{done}</span>
      </div>
    );
  return (
    <div className={cx("l-count", className)} data-size={size} role="timer" aria-label={`${label} left`} data-timer="">
      {shown.map((p) => (
        <span key={p.name} className="l-count__unit">
          <span className="l-count__box l-frame-solo">
            <RollingNumber value={p.n} format={{ minimumIntegerDigits: 2 }} />
          </span>
          <span className="l-count__name">{p.name}</span>
        </span>
      ))}
    </div>
  );
}
