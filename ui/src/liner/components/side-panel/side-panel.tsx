/*
  Liner · Side panel
  The column beside the work: what needs you, a draft, the details. A title that can carry
  a count, sections divided by hairlines, and an optional strip at the foot for the one
  action that matters. It is a white surface; put it in a frame or beside a card.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./side-panel.css";

export type SidePanelProps = {
  title: ReactNode;
  /** A small number beside the title, like things waiting on you. */
  count?: number;
  tone?: "neutral" | "accent" | "warning";
  actions?: ReactNode;
  onClose?: () => void;
  footer?: ReactNode;
  label?: string;
  children: ReactNode;
  className?: string;
};

export function SidePanel({ title, count, tone = "neutral", actions, onClose, footer, label, children, className }: SidePanelProps) {
  return (
    <aside className={cx("l-spanel", className)} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <header className="l-spanel__head">
        <h3 className="l-spanel__title">
          <span className="l-spanel__name">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="l-spanel__count l-num" data-tone={tone} key={count}>
              {count}
            </span>
          )}
        </h3>
        {(actions || onClose) && (
          <div className="l-spanel__actions">
            {actions}
            {onClose && (
              <button type="button" className="l-spanel__btn l-focus" aria-label="Close panel" onClick={onClose}>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}
      </header>
      <div className="l-spanel__body">{children}</div>
      {footer && <div className="l-spanel__foot">{footer}</div>}
    </aside>
  );
}

/** One part of a SidePanel, with a quiet label and room for a control on its right. */
export function SidePanelSection({ label, actions, children, className }: { label?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("l-spanel__sec", className)}>
      {(label || actions) && (
        <header className="l-spanel__sec-head">
          {label && <h4>{label}</h4>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
