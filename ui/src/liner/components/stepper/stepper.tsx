import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { clamp } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./stepper.css";

export type StepperProps = {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  label?: string;
  format?: Intl.NumberFormatOptions;
  size?: "md" | "lg";
  className?: string;
};

export function Stepper({ value, defaultValue = 0, min = -Infinity, max = Infinity, step = 1, onValueChange, label = "Quantity", format, size = "md", className }: StepperProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const currentRef = useRef(current);
  currentRef.current = current;
  const valueRef = useRef<HTMLSpanElement>(null);
  const repeat = useRef<{ t: number; n: number } | null>(null);
  const [held, setHeld] = useState<-1 | 1 | 0>(0);

  useEffect(() => () => stopRepeat(), []);

  function bump(dir: -1 | 1) {
    // Pushing past a limit nudges the number toward the wall, then it settles.
    valueRef.current?.animate([{ transform: "none" }, { transform: `translateX(${dir * 4}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.3,1.4,.4,1)" });
    feedback.play("error");
  }

  function change(dir: -1 | 1, n = 1) {
    const from = currentRef.current;
    const next = clamp(Number((from + dir * step * n).toFixed(6)), min, max);
    if (next === from) {
      bump(dir);
      stopRepeat();
      return;
    }
    currentRef.current = next;
    if (!controlled) setInner(next);
    onValueChange?.(next);
    feedback.play("tick", clamp(Math.round(next / step) % 24, 0, 24));
  }

  // Hold to repeat, accelerating the longer you hold.
  function startRepeat(dir: -1 | 1) {
    change(dir);
    setHeld(dir);
    let n = 0;
    const loop = (delay: number) => {
      repeat.current = {
        n,
        t: window.setTimeout(() => {
          n++;
          change(dir);
          loop(Math.max(36, delay * 0.86));
        }, delay),
      };
    };
    loop(420);
  }
  function stopRepeat() {
    if (repeat.current) window.clearTimeout(repeat.current.t);
    repeat.current = null;
    setHeld(0);
  }

  const button = (dir: -1 | 1) => {
    const atLimit = dir < 0 ? current <= min : current >= max;
    return (
      <button
        type="button"
        tabIndex={-1}
        className="l-stepper__btn l-plate"
        data-limit={atLimit || undefined}
        data-held={held === dir || undefined}
        aria-label={dir < 0 ? "Decrease" : "Increase"}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          startRepeat(dir);
        }}
        onPointerUp={stopRepeat}
        onPointerCancel={stopRepeat}
        onLostPointerCapture={stopRepeat}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3.75 8h8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          {dir > 0 && <path d="M8 3.75v8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        </svg>
      </button>
    );
  };

  return (
    <div
      className={cx("l-stepper", "l-focus", className)}
      data-size={size}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={current}
      aria-valuemin={Number.isFinite(min) ? min : undefined}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      onKeyDown={(e) => {
        const map: Record<string, [-1 | 1, number]> = { ArrowUp: [1, 1], ArrowRight: [1, 1], ArrowDown: [-1, 1], ArrowLeft: [-1, 1], PageUp: [1, 10], PageDown: [-1, 10] };
        if (map[e.key]) {
          e.preventDefault();
          change(...map[e.key]);
        } else if (e.key === "Home" && Number.isFinite(min)) {
          e.preventDefault();
          change(-1, (current - min) / step);
        } else if (e.key === "End" && Number.isFinite(max)) {
          e.preventDefault();
          change(1, (max - current) / step);
        }
      }}
    >
      {button(-1)}
      <span className="l-stepper__value" ref={valueRef}>
        <RollingNumber value={current} format={format} />
      </span>
      {button(1)}
    </div>
  );
}
