/*
  Liner · Rating
  Stars in ink. Hovering previews, pressing sets, and pressing the same star again clears.
  New stars pop in one after another; a word beside them says what the score means.
*/
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { clamp } from "../../lib/spring";
import "./rating.css";

export type RatingProps = {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  max?: number;
  /** Allow halves. */
  half?: boolean;
  readOnly?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  /** A word per whole star, like ["Poor", "Fair", "Good", "Great", "Loved it"]. */
  labels?: string[];
  className?: string;
};

const STAR = "M8 1.6l1.9 3.95 4.3.6-3.12 3.03.75 4.3L8 11.44 4.17 13.48l.75-4.3L1.8 6.15l4.3-.6L8 1.6Z";

export function Rating({ value, defaultValue = 0, onValueChange, max = 5, half, readOnly, size = "md", label = "Rating", labels, className }: RatingProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [hover, setHover] = useState<number | null>(null);
  // Stars that just turned on pop in, once; the marker clears after the animation.
  const [pop, setPop] = useState<{ n: number; from: number; to: number } | null>(null);
  const popN = useRef(0);
  const shown = hover ?? current;
  const step = half ? 0.5 : 1;

  const set = (v: number) => {
    const next = clamp(v, 0, max);
    if (next === current) return;
    const n = ++popN.current;
    setPop(next > current ? { n, from: current, to: next } : null);
    window.setTimeout(() => setPop((p) => (p?.n === n ? null : p)), 900);
    if (!controlled) setInner(next);
    onValueChange?.(next);
    feedback.play(next > current ? "pop" : "tap", Math.ceil(next));
  };
  const at = (e: MouseEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return half && e.clientX - r.left < r.width / 2 ? i + 0.5 : i + 1;
  };
  const onKey = (e: KeyboardEvent) => {
    if (readOnly) return;
    const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
    if (moves[e.key]) set(current + moves[e.key]);
    else if (e.key === "Home") set(0);
    else if (e.key === "End") set(max);
    else if (/^\d$/.test(e.key) && Number(e.key) <= max) set(Number(e.key));
    else return;
    e.preventDefault();
  };
  const word = labels?.[Math.ceil(shown) - 1];

  return (
    <div className={cx("l-rating", className)} data-size={size} data-readonly={readOnly || undefined}>
      <div
        className="l-rating__stars"
        role={readOnly ? "img" : "slider"}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? `${label}: ${current} of ${max}` : label}
        aria-valuemin={readOnly ? undefined : 0}
        aria-valuemax={readOnly ? undefined : max}
        aria-valuenow={readOnly ? undefined : current}
        aria-valuetext={readOnly ? undefined : `${current} of ${max}${labels?.[Math.ceil(current) - 1] ? `, ${labels[Math.ceil(current) - 1]}` : ""}`}
        onKeyDown={onKey}
        onPointerLeave={() => setHover(null)}
      >
        {Array.from({ length: max }, (_, i) => {
          const fill = clamp(shown - i, 0, 1);
          const popping = !!pop && i >= Math.floor(pop.from) && i < Math.ceil(pop.to);
          return (
            <span
              key={i}
              className="l-rating__star"
              data-fill={fill === 1 ? "full" : fill > 0 ? "half" : undefined}
              data-preview={(hover !== null && fill > 0) || undefined}
              onPointerMove={(e) => !readOnly && setHover(at(e, i))}
              onClick={(e) => {
                if (readOnly) return;
                const v = at(e, i);
                setHover(null);
                set(v === current ? 0 : v);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden key={popping ? `p${pop!.n}` : "s"} data-pop={popping || undefined} style={popping ? { animationDelay: `${(i - Math.floor(pop!.from)) * 45}ms` } : undefined}>
                <path d={STAR} className="l-rating__outline" />
                <clipPath id={`l-rating-c${i}-${fill}`}>
                  <rect x="0" y="0" width={16 * fill} height="16" />
                </clipPath>
                <path d={STAR} className="l-rating__fill" clipPath={`url(#l-rating-c${i}-${fill})`} />
              </svg>
            </span>
          );
        })}
      </div>
      {labels && (
        <span className="l-rating__word" key={word ?? "none"} aria-hidden>
          {word ?? "Not rated"}
        </span>
      )}
    </div>
  );
}
