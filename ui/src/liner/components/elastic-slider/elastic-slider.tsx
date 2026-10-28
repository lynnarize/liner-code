/*
  Liner · Elastic slider
  A slider that gives at its ends. Pull past either edge and the track stretches after
  your finger, then springs back when you let go. The track thickens while held, and the
  icons at either end lean with the pull.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { clamp, rubber } from "../../lib/spring";
import "./elastic-slider.css";

export type ElasticSliderProps = {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  format?: (value: number) => string;
  className?: string;
};

export function ElasticSlider({ value, defaultValue = 50, onValueChange, min = 0, max = 100, step = 1, label, startIcon, endIcon, format = (v) => String(Math.round(v)), className }: ElasticSliderProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = clamp(controlled ? value : inner, min, max);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const frac = (current - min) / (max - min);

  const set = (v: number) => {
    const next = clamp(Math.round((v - min) / step) * step + min, min, max);
    if (next === current) return;
    if ((next === min || next === max) && next !== current) feedback.play("tick", next === max ? 6 : 0);
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };

  // Stretch is written straight to the DOM: it changes every frame and is never state.
  const stretch = (over: number) => {
    const r = root.current;
    const t = track.current;
    if (!r || !t) return;
    const w = t.offsetWidth;
    const d = rubber(over, w, 0.3);
    r.style.setProperty("--pull", `${d}px`);
    r.style.setProperty("--sx", String(1 + Math.abs(d) / w));
    r.style.setProperty("--sy", String(1 - Math.min(0.35, (Math.abs(d) / w) * 2.2)));
    r.dataset.side = d < 0 ? "start" : "end";
  };
  const release = () => {
    const r = root.current;
    if (!r) return;
    delete r.dataset.dragging;
    r.style.setProperty("--pull", "0px");
    r.style.setProperty("--sx", "1");
    r.style.setProperty("--sy", "1");
  };
  const nudge = (dir: -1 | 1) => {
    stretch(dir * 22);
    requestAnimationFrame(release);
  };

  return (
    <div ref={root} className={cx("l-elastic", className)}>
      <div className="l-elastic__head">
        <span>{label}</span>
        <span className="l-elastic__value">{format(current)}</span>
      </div>
      <div className="l-elastic__row">
        {startIcon && <span className="l-elastic__icon" data-end="start">{startIcon}</span>}
        <div
          ref={track}
          className="l-elastic__track"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-valuetext={format(current)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            root.current!.dataset.dragging = "";
            const r = e.currentTarget.getBoundingClientRect();
            set(min + ((e.clientX - r.left) / r.width) * (max - min));
          }}
          onPointerMove={(e) => {
            if (!root.current?.hasAttribute("data-dragging")) return;
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            set(min + (x / r.width) * (max - min));
            stretch(x < 0 ? x : x > r.width ? x - r.width : 0);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key] as -1 | 1 | undefined;
            if (dir) {
              e.preventDefault();
              if ((dir < 0 && current === min) || (dir > 0 && current === max)) nudge(dir);
              else set(current + dir * step * (e.shiftKey ? 10 : 1));
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              set(e.key === "Home" ? min : max);
            }
          }}
        >
          <span className="l-elastic__fill" style={{ width: `${frac * 100}%` }} />
        </div>
        {endIcon && <span className="l-elastic__icon" data-end="end">{endIcon}</span>}
      </div>
    </div>
  );
}
