/*
  Liner · Dialog
  A decision that needs the whole screen's attention. The page dims and softens behind a
  glass frame; the content sits on a white card and the actions rest on the glass below it.
  Built on <dialog>, so focus is trapped and returned for free.
*/
import { useId, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { useModal } from "./use-modal";
import "./dialog.css";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons for the glass strip under the card. */
  actions?: ReactNode;
  /** A glyph above the title, like a warning mark for destructive choices. */
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function Dialog({ open, onOpenChange, title, description, children, actions, icon, size = "md", className }: DialogProps) {
  const id = useId();
  const modal = useModal(open, onOpenChange);
  return (
    <dialog {...modal} className={cx("l-dialog", className)} data-size={size} aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined}>
      <div className="l-dialog__frame l-frame l-frame-float">
        <div className="l-frame-card l-dialog__card">
          <button type="button" className="l-dialog__x" aria-label="Close" onClick={() => onOpenChange(false)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
          {icon && <span className="l-dialog__icon">{icon}</span>}
          <h2 id={`${id}-t`} className="l-dialog__title">
            {title}
          </h2>
          {description && (
            <p id={`${id}-d`} className="l-dialog__desc">
              {description}
            </p>
          )}
          {children && <div className="l-dialog__body">{children}</div>}
        </div>
        {actions && <div className="l-frame-strip l-dialog__actions">{actions}</div>}
      </div>
    </dialog>
  );
}
