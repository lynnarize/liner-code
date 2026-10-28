/*
  Liner · Alert
  A message that belongs to the page, not a moment: a white card whose small mark carries
  the tone. Dismissing folds it away instead of leaving a hole.
*/
import { useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./alert.css";

export type AlertTone = "info" | "success" | "warning" | "danger";
export type AlertProps = {
  tone?: AlertTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissible?: boolean;
  className?: string;
};

const ICONS: Record<AlertTone, ReactNode> = {
  info: <path d="M8 7.25v4M8 4.9v.1M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z" />,
  success: <path d="M5.4 8.2 7.2 10l3.4-3.8M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z" />,
  warning: <path d="M8 6.25v3.25M8 11.4v.1M7.1 2.8 1.9 11.9a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.8a1 1 0 0 0-1.8 0Z" />,
  danger: <path d="M8 5v3.75M8 10.9v.1M5.6 2.25h4.8l3.35 3.35v4.8l-3.35 3.35H5.6L2.25 10.4V5.6Z" />,
};

export function Alert({ tone = "info", title, children, actions, onDismiss, dismissible, className }: AlertProps) {
  const [gone, setGone] = useState(false);
  return (
    <div className={cx("l-alert", className)} data-tone={tone} data-gone={gone || undefined} role={tone === "danger" || tone === "warning" ? "alert" : "status"} onTransitionEnd={(e) => gone && e.propertyName === "grid-template-rows" && onDismiss?.()}>
      <div className="l-alert__clip">
        <div className="l-alert__box l-frame-solo">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="l-alert__icon" aria-hidden>
            {ICONS[tone]}
          </svg>
          <div className="l-alert__text">
            <b>{title}</b>
            {children && <div className="l-alert__body">{children}</div>}
            {actions && <div className="l-alert__actions">{actions}</div>}
          </div>
          {(dismissible || onDismiss) && (
            <button type="button" className="l-alert__x" aria-label="Dismiss" onClick={() => setGone(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
