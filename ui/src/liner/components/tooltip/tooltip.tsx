/*
  Liner · Tooltip
  A short label on glass for whatever the pointer rests on or focus reaches. The first one
  waits a moment; once one has shown, its neighbours appear at once, so running along a
  toolbar reads every label without waiting again.
*/
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { cx } from "../../lib/hooks";
import "./tooltip.css";

export type TooltipProps = {
  content: string;
  /** A key hint shown after the text. */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  /** One focusable element: a button or a link. */
  children: ReactElement<Record<string, unknown>>;
  className?: string;
};

// Tooltips share one warm window: within it, the next one skips the delay.
let warmUntil = 0;

export function Tooltip({ content, shortcut, side = "top", delay = 500, children, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const show = (now = false) => {
    window.clearTimeout(t.current);
    if (now || performance.now() < warmUntil) setOpen(true);
    else t.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(t.current);
    if (open) warmUntil = performance.now() + 450;
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const child = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": open ? id : undefined,
        onFocus: (e: FocusEvent) => {
          (children.props.onFocus as ((e: FocusEvent) => void) | undefined)?.(e);
          if ((e.target as HTMLElement).matches(":focus-visible")) show(true);
        },
        onBlur: (e: FocusEvent) => {
          (children.props.onBlur as ((e: FocusEvent) => void) | undefined)?.(e);
          hide();
        },
      })
    : children;

  return (
    <span className={cx("l-tip-anchor", className)} onPointerEnter={() => show()} onPointerLeave={hide} onPointerDown={hide}>
      {child}
      {open && (
        <span id={id} role="tooltip" className="l-tip l-glass" data-side={side}>
          {content}
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
}
