/*
  Liner · Confirm morph
  A destructive button that asks in place: it widens into "Delete project?" with Cancel
  and Delete, turns into a spinner while it works, then shows the result with an Undo
  that drains away. The width springs between every state; nothing jumps.
*/
import { useEffect, useRef, useState } from "react";
import { cx, useSize } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./confirm-morph.css";

type State = "idle" | "ask" | "busy" | "done";

export type ConfirmMorphProps = {
  label: string;
  question?: string;
  confirmLabel?: string;
  doneLabel?: string;
  /** Do the work. The spinner shows until it resolves. */
  onConfirm: () => Promise<void> | void;
  /** Offer Undo for this long after it is done (ms). 0 hides Undo. */
  undoFor?: number;
  onUndo?: () => void;
  className?: string;
};

export function ConfirmMorph({ label, question, confirmLabel = "Delete", doneLabel = "Deleted", onConfirm, undoFor = 5000, onUndo, className }: ConfirmMorphProps) {
  const [state, setState] = useState<State>("idle");
  const [inner, size] = useSize<HTMLSpanElement>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Asking moves focus to Cancel, the safe choice; going back returns it to the trigger.
  const moved = useRef(false);
  useEffect(() => {
    if (state === "ask") cancelRef.current?.focus();
    if (state === "idle" && moved.current) triggerRef.current?.focus({ preventScroll: true });
    if (state !== "idle") moved.current = true;
  }, [state]);

  async function confirm() {
    setState("busy");
    feedback.play("tap", -2);
    await onConfirm();
    setState("done");
    feedback.play("success");
    if (undoFor > 0) timer.current = window.setTimeout(() => setState("idle"), undoFor);
  }

  return (
    <div
      className={cx("l-cmorph", className)}
      data-state={state}
      style={size ? { width: size.width + 8 } : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && state === "ask") setState("idle");
      }}
    >
      <span className="l-cmorph-in" ref={inner}>
        {state === "idle" && (
          <button ref={triggerRef} type="button" className="l-cmorph-trigger l-focus" onClick={() => (setState("ask"), feedback.play("tap", 0))}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="l-cmorph-swap">{label}</span>
          </button>
        )}
        {state === "ask" && (
          <span className="l-cmorph-ask" role="group" aria-label={question ?? `${label}?`}>
            <span className="l-cmorph-q l-cmorph-swap">{question ?? `${label}?`}</span>
            <button ref={cancelRef} type="button" className="l-cmorph-btn l-focus" onClick={() => setState("idle")}>
              Cancel
            </button>
            <button type="button" className="l-cmorph-btn l-focus" data-danger onClick={confirm}>
              {confirmLabel}
            </button>
          </span>
        )}
        {state === "busy" && (
          <span className="l-cmorph-status l-cmorph-swap" role="status">
            <span className="l-cmorph-spin" aria-hidden />
            Working…
          </span>
        )}
        {state === "done" && (
          <span className="l-cmorph-status l-cmorph-swap" role="status">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-cmorph-check">
              <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
            </svg>
            {doneLabel}
            {undoFor > 0 && (
              <button
                type="button"
                className="l-cmorph-undo l-focus"
                style={{ ["--undo" as string]: `${undoFor}ms` }}
                onClick={() => {
                  window.clearTimeout(timer.current);
                  onUndo?.();
                  setState("idle");
                  feedback.play("pop", 2);
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden className="l-cmorph-ring">
                  <circle cx="10" cy="10" r="8" pathLength="1" />
                </svg>
                Undo
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
