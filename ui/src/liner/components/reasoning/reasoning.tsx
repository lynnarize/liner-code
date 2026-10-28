import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { cx, useElapsed, useIsoLayoutEffect } from "../../lib/hooks";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./reasoning.css";

export type ReasoningSource = { name: string; label: string; hue?: number };
export type ReasoningStep = { id: string; label: string; sources?: ReasoningSource[]; more?: number };

export type ReasoningProps = {
  steps: ReasoningStep[];
  /** Work is in progress: the timer ticks and the newest step shimmers. */
  running: boolean;
  defaultOpen?: boolean;
  /** Fold closed a moment after finishing, unless someone opened it by hand. */
  collapseOnDone?: boolean;
  runningLabel?: string;
  doneLabel?: (seconds: number) => string;
  finalLabel?: string;
  className?: string;
};

const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);

/** A letter tile standing in for a source's favicon. */
export function SourceMark({ name, hue, size = 16 }: { name: string; hue?: number; size?: number }) {
  return (
    <span className="l-srcmark" style={{ width: size, height: size, fontSize: size * 0.62, ["--h" as string]: hue ?? hueOf(name) } as CSSProperties} aria-hidden>
      {name.replace(/^#/, "").charAt(0).toUpperCase()}
    </span>
  );
}

export function Reasoning({
  steps,
  running,
  defaultOpen = true,
  collapseOnDone = true,
  runningLabel = "Thinking",
  doneLabel = (s) => `Thought for ${Math.max(1, s)}s`,
  finalLabel = "Finished thinking",
  className,
}: ReasoningProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);
  const [seconds] = useElapsed(running);
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  const wasRunning = useRef(running);

  // The body follows its content's measured height, so new steps glide in too.
  useIsoLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (running) touched.current = false;
    if (!finished || !collapseOnDone) return;
    const t = window.setTimeout(() => !touched.current && setOpen(false), 1100);
    return () => window.clearTimeout(t);
  }, [running, collapseOnDone]);

  const label = running ? runningLabel : doneLabel(seconds);
  const last = steps.length - 1;

  return (
    <div className={cx("l-reason", className)} data-running={running || undefined} data-open={open || undefined}>
      <button
        type="button"
        className="l-reason-head l-focus"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => {
          touched.current = true;
          setOpen((o) => !o);
        }}
      >
        <svg className="l-reason-chev" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="l-reason-label">
          <span key={running ? "run" : "done"} className={running ? "l-reason-swap l-shimmer" : "l-reason-swap"}>
            {label}
          </span>
        </span>
        {running && (
          <span className="l-reason-time" data-timer="">
            <RollingNumber value={seconds} />s
          </span>
        )}
      </button>
      <div id={`${id}-body`} className="l-reason-body" style={{ height: open ? (h ?? "auto") : 0 }} aria-hidden={!open} inert={!open}>
        <div ref={innerRef} className="l-reason-inner">
          <ol className="l-reason-steps">
            {steps.map((st, i) => {
              const active = running && i === last;
              return (
                <li key={st.id} className="l-reason-step" data-active={active || undefined} data-kind={st.sources ? "search" : "step"}>
                  <span className="l-reason-dot" aria-hidden>
                    {st.sources ? (
                      <svg viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M2.4 8h11.2M8 2.25c1.6 1.7 2.4 3.6 2.4 5.75S9.6 12.05 8 13.75C6.4 12.05 5.6 10.15 5.6 8S6.4 3.95 8 2.25Z" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    ) : null}
                  </span>
                  <div className="l-reason-content">
                    <span className={active ? "l-reason-text l-shimmer" : "l-reason-text"}>{st.label}</span>
                    {st.sources && (
                      <div className="l-reason-chips">
                        {st.sources.map((s, k) => (
                          <span key={s.label} className="l-reason-chip" style={{ animationDelay: `${k * 70}ms` }}>
                            <SourceMark name={s.name} hue={s.hue} size={14} />
                            {s.label}
                          </span>
                        ))}
                        {st.more ? (
                          <span className="l-reason-more" style={{ animationDelay: `${st.sources.length * 70}ms` }}>
                            +{st.more} more
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {!running && steps.length > 0 && (
              <li className="l-reason-step l-reason-final">
                <span className="l-reason-dot l-reason-check" aria-hidden>
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M4.6 8.3 7 10.6l4.5-4.9" pathLength="1" />
                  </svg>
                </span>
                <div className="l-reason-content">
                  <span className="l-reason-text">{finalLabel}</span>
                </div>
              </li>
            )}
          </ol>
        </div>
      </div>
      <span className="l-sr-only" aria-live="polite">
        {running ? steps[last]?.label ?? runningLabel : label}
      </span>
    </div>
  );
}
