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
        <svg className="l-think__rays" viewBox="0 0 20 20">
          <g className="l-think__turn">
            {Array.from({ length: 8 }, (_, k) => (
              <line key={k} x1="10" y1="2.6" x2="10" y2="5.4" opacity={k ? 0.18 + (0.82 * k) / 8 : 1} transform={`rotate(${k * 45} 10 10)`} />
            ))}
          </g>
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
