import { useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { clamp } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import "./switch.css";

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Draws a check inside the thumb when on. */
  icons?: boolean;
  className?: string;
};

export function Switch({ checked, defaultChecked = false, onCheckedChange, label, description, disabled, size = "md", icons, className }: SwitchProps) {
  const id = useId();
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(defaultChecked);
  const on = controlled ? checked : inner;
  const [pressed, setPressed] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; moved: boolean; from: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pointerHandled = useRef(false);

  function set(next: boolean) {
    if (next === on) return;
    if (!controlled) setInner(next);
    onCheckedChange?.(next);
    feedback.play("toggle", next ? 2 : -2);
  }

  // Travel in px between the off and on thumb positions.
  function travel() {
    const el = btnRef.current;
    if (!el) return 18;
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.getPropertyValue("--pad")) * 2 - parseFloat(cs.getPropertyValue("--tw"));
  }

  return (
    <div className={cx("l-switch-row", className)} data-disabled={disabled || undefined}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={label ? `${id}-l` : undefined}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        className="l-switch l-focus"
        data-on={on || undefined}
        data-size={size}
        data-pressed={pressed || undefined}
        data-dragging={drag !== null || undefined}
        style={drag !== null ? { ["--drag" as string]: `${drag}px` } : undefined}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, moved: false, from: on ? travel() : 0 };
          setPressed(true);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (!s.moved && Math.abs(dx) < 4) return;
          s.moved = true;
          setDrag(clamp(s.from + dx, 0, travel()));
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          setPressed(false);
          if (!s) return;
          pointerHandled.current = true;
          window.setTimeout(() => (pointerHandled.current = false), 0);
          if (s.moved) {
            const x = clamp(s.from + (e.clientX - s.x), 0, travel());
            setDrag(null);
            set(x > travel() / 2);
          } else {
            set(!on);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setPressed(false);
          setDrag(null);
        }}
        onClick={() => {
          // Pointer toggles already happened on pointerup. Keyboard and label clicks land here.
          if (pointerHandled.current) {
            pointerHandled.current = false;
            return;
          }
          set(!on);
        }}
      >
        <span className="l-switch__thumb">
          {icons && (
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4.2 8.3 6.8 10.8 11.8 5.4" pathLength="1" />
            </svg>
          )}
        </span>
      </button>
      {(label || description) && (
        <span className="l-switch__text">
          {label && (
            <label id={`${id}-l`} htmlFor={id} className="l-switch__label">
              {label}
            </label>
          )}
          {description && (
            <span id={`${id}-d`} className="l-switch__desc">
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
