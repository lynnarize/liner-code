/*
  Liner · Image compare
  Before and after, one over the other, split by a line you drag. The handle is a small
  glass knob; pressing anywhere jumps the line there, and the arrow keys nudge it.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { clamp } from "../../lib/spring";
import "./image-compare.css";

export type ImageCompareProps = {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
  defaultValue?: number;
  aspect?: string;
  className?: string;
};

export function ImageCompare({ before, after, beforeLabel = "Before", afterLabel = "After", defaultValue = 50, aspect = "16 / 10", className }: ImageCompareProps) {
  const [v, setV] = useState(defaultValue);
  const [held, setHeld] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const r = root.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100, 0, 100);
  };
  return (
    <div
      ref={root}
      className={cx("l-compare l-frame-solo", className)}
      data-held={held || undefined}
      style={{ aspectRatio: aspect, ["--v" as string]: `${v}%` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setHeld(true);
        setV(at(e.clientX));
      }}
      onPointerMove={(e) => held && setV(at(e.clientX))}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
    >
      <div className="l-compare__layer">{after}</div>
      <div className="l-compare__layer l-compare__before">{before}</div>
      <span className="l-compare__label" data-side="before" aria-hidden>
        {beforeLabel}
      </span>
      <span className="l-compare__label" data-side="after" aria-hidden>
        {afterLabel}
      </span>
      <div
        className="l-compare__line"
        role="slider"
        tabIndex={0}
        aria-label={`${beforeLabel} and ${afterLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v)}
        aria-valuetext={`${Math.round(v)}% ${beforeLabel.toLowerCase()}`}
        onKeyDown={(e) => {
          const d = { ArrowLeft: -2, ArrowRight: 2, Home: -100, End: 100 }[e.key];
          if (d === undefined) return;
          e.preventDefault();
          setV((x) => clamp(x + d * (e.shiftKey ? 5 : 1), 0, 100));
        }}
      >
        <span className="l-compare__knob l-glass" aria-hidden>
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M6 4.5 2.5 8 6 11.5M10 4.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
