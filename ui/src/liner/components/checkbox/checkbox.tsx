import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./checkbox.css";

export type CheckboxProps = {
  checked?: boolean | "mixed";
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Draw a line through the label when checked, for task lists. */
  strike?: boolean;
  disabled?: boolean;
  className?: string;
};

export function Checkbox({ checked, defaultChecked = false, onCheckedChange, label, description, strike, disabled, className }: CheckboxProps) {
  const id = useId();
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(defaultChecked);
  const state = controlled ? checked : inner;
  const on = state === true;
  const mixed = state === "mixed";
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <label className={cx("l-check", className)} data-on={on || undefined} data-mixed={mixed || undefined} data-strike={strike || undefined} data-disabled={disabled || undefined} htmlFor={id}>
      <span className="l-check__box">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          className="l-check__input"
          checked={on}
          disabled={disabled}
          aria-checked={mixed ? "mixed" : on}
          aria-describedby={description ? `${id}-d` : undefined}
          onChange={(e) => {
            const next = mixed ? true : e.target.checked;
            if (!controlled) setInner(next);
            onCheckedChange?.(next);
            feedback.play(next ? "pop" : "tap", next ? 3 : 0);
          }}
        />
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-check__mark">
          <path className="l-check__tick" d="M3.9 8.5 6.7 11.1 12.2 5.2" pathLength="1" />
          <path className="l-check__dash" d="M4.5 8h7" pathLength="1" />
        </svg>
      </span>
      {(label || description) && (
        <span className="l-check__text">
          {label && <span className="l-check__label">{label}</span>}
          {description && (
            <span id={`${id}-d`} className="l-check__desc">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}
