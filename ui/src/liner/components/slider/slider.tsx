import { useEffect, useId, useRef, useState } from "react";
import { cx, useSpring } from "../../lib/hooks";
import { clamp, rubber, springs } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import "./slider.css";

export type SliderProps = {
  label: string;
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  format?: (value: number) => string;
  onValueChange?: (value: number) => void;
  /** Show detent marks when there are few enough steps. */
  marks?: boolean;
  className?: string;
};

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

export function Slider({ label, value, defaultValue, min = 0, max = 100, step = 1, unit = "", format, onValueChange, marks = true, className }: SliderProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = clamp(controlled ? value : inner, min, max);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; from: number; moved: boolean; w: number } | null>(null);
  const lastTickValue = useRef(current);
  // Written once; after that the springs own --f so React never fights them mid-flight.
  const initialFrac = useRef(max === min ? 0 : (current - min) / (max - min)).current;

  const frac = (v: number) => (max === min ? 0 : (v - min) / (max - min));
  const snap = (v: number) => clamp(Number((Math.round((v - min) / step) * step + min).toFixed(decimals(step))), min, max);

  // The fill rides a smooth spring for keyboard and click changes, and follows 1:1 while dragging.
  const fill = useSpring(frac(current), springs.smooth, (f) => barRef.current?.style.setProperty("--f", String(f)));
  // Overscroll stretch: the bar gives a little past either end, then springs home.
  const stretch = useSpring(0, springs.snappy, (s) => {
    const el = barRef.current;
    if (!el) return;
    el.style.setProperty("--sx", String(1 + Math.abs(s)));
    el.style.transformOrigin = s < 0 ? "right center" : "left center";
  });

  useEffect(() => {
    if (!drag.current) fill.set(frac(current));
  }, [current, min, max]);

  function commit(v: number) {
    const next = snap(v);
    if (next !== current) {
      if (!controlled) setInner(next);
      onValueChange?.(next);
    }
    if (next !== lastTickValue.current) {
      lastTickValue.current = next;
      feedback.play("tick", Math.round(frac(next) * 12));
    }
    return next;
  }

  const count = Math.round((max - min) / step);
  const showMarks = marks && count > 1 && count <= 24;
  const text = format ? format(current) : current.toFixed(decimals(step));

  return (
    <div className={cx("l-slider", className)} data-dragging={dragging || undefined}>
      <div
        ref={barRef}
        className="l-slider__bar"
        style={{ ["--f" as string]: initialFrac }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, from: current, moved: false, w: e.currentTarget.clientWidth };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 3) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
          }
          // Relative drag: grabbing anywhere never makes the value jump.
          const raw = frac(d.from) + dx / d.w;
          const over = raw < 0 ? raw * d.w : raw > 1 ? (raw - 1) * d.w : 0;
          fill.jump(clamp(raw, 0, 1));
          stretch.jump(over ? rubber(over, d.w, 0.2) / d.w / 6 : 0);
          commit(min + clamp(raw, 0, 1) * (max - min));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          stretch.set(0);
          if (!d) return;
          if (!d.moved) {
            // A tap jumps to that spot, on a spring.
            const r = e.currentTarget.getBoundingClientRect();
            const next = commit(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min));
            fill.set(frac(next));
          } else {
            fill.set(frac(snap(current)));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          stretch.set(0);
          fill.set(frac(current));
        }}
      >
        <span className="l-slider__fill" aria-hidden />
        {showMarks && (
          <span className="l-slider__marks" aria-hidden>
            {Array.from({ length: count - 1 }, (_, i) => (
              <span key={i} style={{ left: `${((i + 1) / count) * 100}%` }} data-on={(i + 1) / count <= frac(current) + 1e-6 || undefined} />
            ))}
          </span>
        )}
        <span className="l-slider__edge" aria-hidden />
        <label className="l-slider__label" htmlFor={id}>
          {label}
        </label>
        <span className="l-slider__value l-num" aria-hidden>
          {text}
          {unit && <span className="l-slider__unit">{unit}</span>}
        </span>
        <input
          id={id}
          className="l-slider__range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={current}
          aria-valuetext={`${text}${unit}`}
          onChange={(e) => commit(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
