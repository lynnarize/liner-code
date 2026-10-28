/*
  Liner · Action button
  A compact toolbar button. Icon first; the label shows as a tooltip (with its shortcut)
  after the pointer rests, or beside the icon when there is room. It can also toggle.
*/
import { useId, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useIntent } from "../../lib/overlay";
import "./action-button.css";

export type ActionButtonProps = {
  icon: ReactNode;
  label: string;
  /** Show the label beside the icon instead of only in the tooltip. */
  showLabel?: boolean;
  shortcut?: string;
  /** Make it a toggle (aria-pressed). */
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  onClick?: () => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
};

export function ActionButton({ icon, label, showLabel, shortcut, pressed, onPressedChange, onClick, size = "md", disabled, className }: ActionButtonProps) {
  const id = useId();
  const tip = useIntent(500, 60);
  const toggle = pressed !== undefined;
  return (
    <span className={cx("l-act-wrap", className)} onPointerEnter={() => tip.enter()} onPointerLeave={tip.leave}>
      <button
        type="button"
        className="l-act l-focus"
        data-size={size}
        data-on={pressed || undefined}
        data-labelled={showLabel || undefined}
        aria-pressed={toggle ? pressed : undefined}
        aria-label={showLabel ? undefined : label}
        aria-describedby={tip.open && !showLabel ? `${id}-tip` : undefined}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && tip.enter(true)}
        onBlur={tip.leave}
        onClick={() => {
          tip.setOpen(false);
          if (toggle) {
            onPressedChange?.(!pressed);
            feedback.play(pressed ? "tap" : "pop", pressed ? -1 : 3);
          } else feedback.play("tap", 2);
          onClick?.();
        }}
      >
        <span className="l-act-icon" aria-hidden>
          {icon}
        </span>
        {showLabel && <span className="l-act-label">{label}</span>}
      </button>
      {tip.open && !showLabel && !disabled && (
        <span id={`${id}-tip`} role="tooltip" className="l-act-tip">
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
}
