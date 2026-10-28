import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { prefersReducedMotion } from "../../lib/spring";
import "./hold-to-confirm.css";

export type HoldToConfirmProps = {
  children?: ReactNode;
  doneLabel?: ReactNode;
  hintLabel?: ReactNode;
  /** Milliseconds the press must last. */
  duration?: number;
  /** Return a promise to keep the button busy until it settles. */
  onConfirm?: () => void | Promise<void>;
  /** Settle back to idle after confirming. Pass null to stay confirmed. */
  resetAfter?: number | null;
  icon?: ReactNode;
  size?: "md" | "lg";
  className?: string;
};

type State = "idle" | "hint" | "holding" | "done";

export function HoldToConfirm({
  children = "Delete project",
  doneLabel = "Deleted",
  hintLabel = "Hold to confirm",
  duration = 1200,
  onConfirm,
  resetAfter = 2400,
  icon,
  size = "md",
  className,
}: HoldToConfirmProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>("idle");
  const stateRef = useRef<State>("idle");
  const progress = useRef(0);
  const raf = useRef(0);
  const startedAt = useRef(0);
  const timers = useRef<number[]>([]);

  const set = (s: State) => {
    stateRef.current = s;
    setState(s);
  };
  const paint = (p: number) => {
    progress.current = p;
    ref.current?.style.setProperty("--p", p.toFixed(4));
  };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  function start() {
    if (stateRef.current === "done" || stateRef.current === "holding") return;
    set("holding");
    startedAt.current = performance.now();
    const from = progress.current;
    let lastQuarter = Math.floor(from * 4);
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      // Ease-in: it starts patient, then commits.
      const t = Math.min(1, from + (now - startedAt.current) / duration);
      paint(t * t * (1.6 - 0.6 * t));
      const quarter = Math.floor(t * 4);
      if (quarter > lastQuarter && quarter < 4) {
        lastQuarter = quarter;
        feedback.play("tick", quarter * 2);
      }
      if (t >= 1) return finish();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  async function finish() {
    paint(1);
    set("done");
    feedback.play("success");
    await onConfirm?.();
    if (resetAfter !== null) later(() => drain(true), resetAfter);
  }

  function release() {
    if (stateRef.current !== "holding") return;
    cancelAnimationFrame(raf.current);
    const quick = performance.now() - startedAt.current < 220;
    set(quick ? "hint" : "idle");
    if (quick) later(() => stateRef.current === "hint" && set("idle"), 1400);
    drain(false);
  }

  // Exits are faster than entrances: the fill drains in ~260ms.
  function drain(reset: boolean) {
    if (reset) set("idle");
    if (prefersReducedMotion()) return paint(0);
    const from = progress.current;
    const t0 = performance.now();
    const ms = 160 + 140 * from;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      paint(from * (1 - (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  }

  const label = (key: State, node: ReactNode) => (
    <span className="l-hold__label" data-on={(state === key || (key === "idle" && state === "holding")) || undefined}>
      {key === "done" ? (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-hold__check">
          <path d="M3.5 8.4 6.6 11.3 12.5 4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
        </svg>
      ) : (
        key === "idle" && icon
      )}
      {node}
    </span>
  );

  const labels = (
    <>
      {label("idle", children)}
      {label("hint", hintLabel)}
      {label("done", doneLabel)}
    </>
  );

  return (
    <button
      ref={ref}
      type="button"
      className={cx("l-hold", "l-focus", className)}
      data-state={state}
      data-size={size}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
      }}
      onBlur={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="l-hold__base">{labels}</span>
      <span className="l-hold__fill" aria-hidden>
        {labels}
      </span>
      <span className="l-sr-only" role="status" aria-live="polite">
        {state === "hint" ? "Press and hold to confirm" : state === "done" ? "Confirmed" : ""}
      </span>
    </button>
  );
}
