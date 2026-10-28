/*
  Liner · Popover
  A small glass panel tied to a button, for content that is more than a menu: a form, a
  few settings, a preview. It opens from its trigger, flips when there's no room, and
  closes on Escape or a press outside, handing focus back.
*/
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { useDismiss, useFlip } from "../../lib/overlay";
import "../menu/menu.css";
import "./popover.css";

export type PopoverProps = {
  /** What the trigger button shows. */
  trigger: ReactNode;
  /** Names the trigger when it shows only an icon. */
  label?: string;
  title?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  width?: number;
  /** Style the trigger as a quiet icon button. */
  iconOnly?: boolean;
  className?: string;
};

export function Popover({ trigger, label, title, children, open, onOpenChange, align = "start", side: prefer = "bottom", width = 300, iconOnly, className }: PopoverProps) {
  const id = useId();
  const controlled = open !== undefined;
  const [inner, setInner] = useState(false);
  const isOpen = controlled ? open : inner;
  const set = (o: boolean) => {
    if (!controlled) setInner(o);
    onOpenChange?.(o);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(isOpen, btn, panel, prefer);
  useDismiss(isOpen, () => set(false), [wrap], btn);
  useEffect(() => {
    if (!isOpen) return;
    // Focus the first thing to use inside, or the panel itself.
    requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>("input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])");
      (first ?? panel.current)?.focus({ preventScroll: true });
    });
  }, [isOpen]);
  const close = () => {
    set(false);
    btn.current?.focus({ preventScroll: true });
  };
  return (
    <div ref={wrap} className={cx("l-anchor l-popover", className)}>
      <button
        ref={btn}
        type="button"
        className="l-menu-trigger l-popover__trigger"
        data-icon-only={iconOnly || undefined}
        data-open={isOpen || undefined}
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => set(!isOpen)}
      >
        {trigger}
      </button>
      {isOpen && (
        <div ref={panel} id={id} className="l-pop l-popover__panel" data-side={side} data-align={align} role="dialog" aria-label={title ?? label} tabIndex={-1} style={{ width }}>
          {title && <div className="l-popover__title">{title}</div>}
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
