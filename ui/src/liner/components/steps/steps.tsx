/*
  Liner · Steps
  Where you are in a process. Done steps carry a check and can be revisited; the line
  between steps fills as you move on, and the current step's number sits in an ink circle.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./steps.css";

export type Step = { title: string; description?: ReactNode };
export type StepsProps = {
  steps: Step[];
  /** Index of the current step. */
  current: number;
  onStepClick?: (index: number) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
};

export function Steps({ steps, current, onStepClick, orientation = "horizontal", className }: StepsProps) {
  return (
    <ol className={cx("l-steps", className)} data-orientation={orientation} aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const click = onStepClick && i < current;
        const Tag = click ? "button" : "span";
        return (
          <li key={s.title} className="l-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <Tag className="l-step__head" {...(click ? { type: "button" as const, onClick: () => onStepClick(i) } : {})}>
              <span className="l-step__dot" aria-hidden>
                {state === "done" ? (
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="l-step__text">
                <b>{s.title}</b>
                {s.description && <span>{s.description}</span>}
              </span>
              <span className="l-step-sr">{state === "done" ? " (done)" : state === "current" ? " (current)" : ""}</span>
            </Tag>
            {i < steps.length - 1 && (
              <span className="l-step__line" aria-hidden>
                <i />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
