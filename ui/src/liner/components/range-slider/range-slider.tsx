/*
  Liner · Range slider
  Two thumbs for a low and a high, over a histogram of what is there. Bars inside the range
  stay ink, the rest fade, so you see how much you are keeping before you let go.
*/
import { useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { clamp } from "../../lib/spring";
import "./range-slider.css";

export type RangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  value?: [number, number];
  defaultValue?: [number, number];
  onValueChange?: (range: [number, number]) => void;
  /** Counts per bucket, spread evenly from min to max. */
  histogram?: number[];
  /** Smallest distance between the thumbs. */
  minGap?: number;
  format?: (value: number) => string;
  label: string;
  className?: string;
};

export function RangeSlider({ min, max, step = 1, value, defaultValue, onValueChange, histogram, minGap = 0, format = String, label, className }: RangeSliderProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState<[number, number]>(defaultValue ?? [min, max]);
  const [lo, hi] = controlled ? value : inner;
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<0 | 1 | null>(null);
  const frac = (v: number) => (v - min) / (max - min);
  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min, min, max);

  const set = (which: 0 | 1, v: number) => {
    const s = snap(v);
    const next: [number, number] = which === 0 ? [Math.min(s, hi - minGap), hi] : [lo, Math.max(s, lo + minGap)];
    if (next[0] === lo && next[1] === hi) return;
    if (!controlled) setInner(next);
    onValueChange?.(next);
    feedback.play("tick", Math.round(frac(next[which]) * 8));
  };
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return min + clamp((clientX - r.left) / r.width, 0, 1) * (max - min);
  };
  const key = (which: 0 | 1) => (e: KeyboardEvent) => {
    const v = which === 0 ? lo : hi;
    const big = Math.max(step, (max - min) / 10);
    const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
    if (moves[e.key]) set(which, v + moves[e.key]);
    else if (e.key === "Home") set(which, min);
    else if (e.key === "End") set(which, max);
    else return;
    e.preventDefault();
  };

  const peak = histogram ? Math.max(1, ...histogram) : 1;
  return (
    <div className={cx("l-range", className)} data-active={active !== null || undefined}>
      {histogram && (
        <div className="l-range__bars" aria-hidden>
          {histogram.map((n, i) => {
            const mid = min + ((i + 0.5) / histogram.length) * (max - min);
            return <i key={i} data-in={(mid >= lo && mid <= hi) || undefined} style={{ height: `${Math.max(4, (n / peak) * 100)}%` }} />;
          })}
        </div>
      )}
      <div
        ref={track}
        className="l-range__track"
        onPointerDown={(e) => {
          const v = at(e.clientX);
          // The nearer thumb takes the press; ties go to whichever has room to move.
          const which: 0 | 1 = Math.abs(v - lo) < Math.abs(v - hi) || (lo === hi && v < lo) ? 0 : 1;
          e.currentTarget.setPointerCapture(e.pointerId);
          setActive(which);
          set(which, v);
          (e.currentTarget.querySelectorAll<HTMLElement>("[role=slider]")[which] as HTMLElement).focus({ preventScroll: true });
        }}
        onPointerMove={(e) => active !== null && set(active, at(e.clientX))}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
      >
        <span className="l-range__rail" />
        <span className="l-range__fill" style={{ left: `${frac(lo) * 100}%`, right: `${(1 - frac(hi)) * 100}%` }} />
        {([lo, hi] as const).map((v, which) => (
          <span
            key={which}
            className="l-range__thumb"
            role="slider"
            tabIndex={0}
            data-held={active === which || undefined}
            aria-label={`${label} ${which === 0 ? "minimum" : "maximum"}`}
            aria-valuemin={which === 0 ? min : lo + minGap}
            aria-valuemax={which === 0 ? hi - minGap : max}
            aria-valuenow={v}
            aria-valuetext={format(v)}
            style={{ left: `${frac(v) * 100}%` }}
            onKeyDown={key(which as 0 | 1)}
          />
        ))}
      </div>
      <div className="l-range__read">
        <span>
          <small>Min</small>
          <b key={lo}>{format(lo)}</b>
        </span>
        <i aria-hidden />
        <span>
          <small>Max</small>
          <b key={hi}>{format(hi)}</b>
        </span>
      </div>
    </div>
  );
}
