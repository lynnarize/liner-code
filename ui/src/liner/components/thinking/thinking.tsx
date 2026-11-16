import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import "./thinking.css";

export type ThinkingProps = {
  /** Phases roll through in order while working. */
  phases?: string[];
  /** Milliseconds per phase. */
  interval?: number;
  done?: boolean;
  doneLabel?: (seconds: string) => string;
  className?: string;
};

export function Thinking({
  phases = ["Thinking", "Reading 12 sources", "Comparing answers", "Writing response"],
  interval = 1600,
  done = false,
  doneLabel = (s) => `Done in ${s}s`,
  className,
}: ThinkingProps) {
  const [i, setI] = useState(0);
  const started = useRef(performance.now());
  const [elapsed, setElapsed] = useState("0.0");

  useEffect(() => {
    if (done) {
      setElapsed(((performance.now() - started.current) / 1000).toFixed(1));
      return;
    }
    started.current = performance.now();
    setI(0);
    const id = window.setInterval(() => setI((n) => Math.min(n + 1, phases.length - 1)), interval);
    return () => window.clearInterval(id);
  }, [done, interval, phases.length]);

  const label = done ? doneLabel(elapsed) : phases[i];

  return (
    <div className={cx("l-think", className)} data-done={done || undefined} role="status" aria-live="polite">
      <span className="l-think__mark" aria-hidden>
        {/* The same spinner as everywhere else in Liner: an accent arc travelling on the waiting ring. */}
        <svg className="l-think__rays" viewBox="0 0 16 16" fill="none">
          <circle className="l-rays__track" cx="8" cy="8" r="5.75" />
          <circle className="l-rays__arc" cx="8" cy="8" r="5.75" strokeLinecap="round" strokeDasharray="9 40" />
        </svg>
        <svg className="l-think__check" viewBox="0 0 20 20" fill="none">
          <path d="M5.6 10.4 8.6 13.2 14.4 7" pathLength="1" />
        </svg>
      </span>
      {/* Every label shares one cell; the pill width springs to the new one. */}
      <span className="l-think__labels">
        <span className="l-think__label" key={label} data-shimmer={!done || undefined}>
          {label}
        </span>
      </span>
    </div>
  );
}
