/*
  Liner Pro · Slide to confirm
  A commit gesture for actions that move money or can't be undone.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, useSpring } from "../../lib/hooks";
import { clamp, rubber, springs } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import "./slide-to-confirm.css";

export type SlideToConfirmProps = {
  label?: ReactNode;
  busyLabel?: ReactNode;
  doneLabel?: ReactNode;
  /** Return a promise to show a busy state until it settles. */
  onConfirm?: () => void | Promise<void>;
  /** Fraction of the track that commits on release. */
  threshold?: number;
  resetAfter?: number | null;
  className?: string;
};

type Phase = "idle" | "dragging" | "busy" | "done";

export function SlideToConfirm({
  label = "Slide to pay $48.00",
  busyLabel = "Processing",
  doneLabel = "Paid",
  onConfirm,
  threshold = 0.82,
  resetAfter = 2600,
  className,
}: SlideToConfirmProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const drag = useRef<{ x: number; from: number; samples: Array<[number, number]> } | null>(null);
  const lastQuarter = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const max = () => {
    const root = rootRef.current;
    const grip = gripRef.current;
    return root && grip ? root.clientWidth - grip.offsetWidth - 8 : 200;
  };

  // x drives the grip, the wash behind it and the label fade, all from one variable.
  const x = useSpring(0, springs.smooth, (v) => {
    const m = max();
    rootRef.current?.style.setProperty("--x", `${v}px`);
    rootRef.current?.style.setProperty("--p", String(clamp(v / m, 0, 1)));
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function commit() {
    go("busy");
    x.set(max(), { config: springs.snappy });
    feedback.play("success");
    try {
      await onConfirm?.();
    } finally {
      go("done");
      if (resetAfter !== null)
        timer.current = window.setTimeout(() => {
          go("idle");
          lastQuarter.current = 0;
          x.set(0);
        }, resetAfter);
    }
  }

  function release(velocity: number) {
    const v = x.value;
    const m = max();
    if (v / m >= threshold || (velocity > 0.9 && v / m > 0.35)) commit();
    else {
      go("idle");
      lastQuarter.current = 0;
      // Hand the release velocity to the spring so the grip glides home, not snaps.
      x.set(0, { velocity: velocity * 1000 });
    }
  }

  const locked = phase === "busy" || phase === "done";

  return (
    <div className={cx("l-slide", className)} ref={rootRef} data-phase={phase}>
      <span className="l-slide__wash" aria-hidden />
      <span className="l-slide__label" aria-hidden>
        <span className="l-slide__text">{label}</span>
      </span>
      <span className="l-slide__result" aria-hidden={phase !== "done"}>
        <span className="l-slide__result-in">
          {phase === "busy" ? (
            <svg viewBox="0 0 16 16" fill="none" className="l-slide__spin" aria-hidden>
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.75" />
              <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none" className="l-slide__check" aria-hidden>
              <path d="M3.5 8.4 6.6 11.3 12.5 4.9" pathLength="1" />
            </svg>
          )}
          <span key={phase}>{phase === "busy" ? busyLabel : doneLabel}</span>
        </span>
      </span>
      <button
        ref={gripRef}
        type="button"
        className="l-slide__grip l-focus"
        aria-label={typeof label === "string" ? `${label}. Press Enter to confirm.` : "Slide to confirm"}
        disabled={locked}
        onPointerDown={(e) => {
          if (locked || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, from: x.value, samples: [[performance.now(), e.clientX]] };
          go("dragging");
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const m = max();
          const raw = d.from + e.clientX - d.x;
          // Past either end the grip resists like rubber instead of hitting a wall.
          const v = raw < 0 ? rubber(raw, m, 0.4) * 0.3 : raw > m ? m + rubber(raw - m, m, 0.4) * 0.3 : raw;
          x.jump(v);
          d.samples.push([performance.now(), e.clientX]);
          if (d.samples.length > 5) d.samples.shift();
          const q = Math.floor(clamp(v / m, 0, 0.999) * 4);
          if (q > lastQuarter.current) feedback.play("tick", q * 3);
          lastQuarter.current = q;
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const [t0, x0] = d.samples[0];
          const [t1, x1] = d.samples[d.samples.length - 1];
          release(t1 > t0 ? (x1 - x0) / (t1 - t0) : 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          release(0);
        }}
        onKeyDown={(e) => {
          if (locked) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            commit();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            x.set(Math.min(max() * 0.3, x.value + 24));
          }
        }}
        onKeyUp={(e) => {
          if (e.key === "ArrowRight" && phaseRef.current === "idle") window.setTimeout(() => phaseRef.current === "idle" && x.set(0), 500);
        }}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden className="l-slide__arrow">
          <path d="M4.5 10h10.5M10.8 5.6 15.2 10l-4.4 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="l-sr-only" role="status" aria-live="polite">
        {phase === "busy" ? "Processing" : phase === "done" ? String(doneLabel) : ""}
      </span>
    </div>
  );
}
