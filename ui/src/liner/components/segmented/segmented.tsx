import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./segmented.css";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; count?: number; disabled?: boolean };

export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  variant?: "pill" | "underline";
  size?: "sm" | "md" | "lg";
  /** Stretch to fill the row with equal segments. */
  full?: boolean;
  /** Lay segments out in a grid this many columns wide; the pill glides in both axes. */
  columns?: number;
  className?: string;
  "aria-label"?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  variant = "pill",
  size = "md",
  full,
  columns,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  const name = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState<T>(defaultValue ?? options[0]?.value);
  const current = controlled ? value : inner;
  const trackRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ l: number; r: number; t: number; b: number } | null>(null);
  const [dir, setDir] = useState<"left" | "right" | null>(null);
  const [pressed, setPressed] = useState(false);
  const [ready, setReady] = useState(false);
  const dragging = useRef(false);

  const index = Math.max(0, options.findIndex((o) => o.value === current));

  function select(v: T) {
    if (v === current) return;
    const next = options.findIndex((o) => o.value === v);
    setDir(next > index ? "right" : "left");
    if (!controlled) setInner(v);
    onValueChange?.(v);
    feedback.play("tick", next * 2);
  }

  // Position the pill from the active option's box; left and right edges move on
  // different timings so the pill stretches toward where it is going.
  const measure = () => {
    const track = trackRef.current;
    const el = track?.querySelectorAll<HTMLElement>("[data-seg-opt]")[index];
    if (!track || !el) return;
    setPill({
      l: el.offsetLeft,
      r: track.clientWidth - el.offsetLeft - el.offsetWidth,
      t: el.offsetTop,
      b: track.clientHeight - el.offsetTop - el.offsetHeight,
    });
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useIsoLayoutEffect(measure, [index, options.length, variant, size, full, columns]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(track);
    // Fonts can land after first paint and change option widths.
    document.fonts?.ready.then(() => measureRef.current());
    const id = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(id);
    };
  }, []);

  function onKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    let target = e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[enabled.length - 1] : index;
    if (step) {
      const pos = enabled.indexOf(index);
      target = enabled[(pos + step + enabled.length) % enabled.length];
    }
    select(options[target].value);
    trackRef.current?.querySelectorAll<HTMLElement>("[data-seg-opt]")[target]?.focus();
  }

  return (
    <div
      className={cx("l-seg", className)}
      data-variant={variant}
      data-size={size}
      data-full={full || columns ? true : undefined}
      data-columns={columns || undefined}
      style={columns ? { ["--sg-cols" as string]: columns } : undefined}
      data-pressed={pressed || undefined}
      data-ready={ready || undefined}
    >
      <div
        className="l-seg__track"
        ref={trackRef}
        role="radiogroup"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          setPressed(true);
          dragging.current = true;
        }}
        onPointerMove={(e) => {
          // Drag across the control to scrub through options, like a native one.
          if (!dragging.current || e.pointerType === "touch") return;
          const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-seg-opt]");
          const v = target?.dataset.value as T | undefined;
          if (v && target?.parentElement === trackRef.current && !target.hasAttribute("disabled")) select(v);
        }}
        onPointerUp={() => {
          setPressed(false);
          dragging.current = false;
        }}
        onPointerLeave={() => {
          setPressed(false);
          dragging.current = false;
        }}
      >
        <span
          className="l-seg__pill"
          data-dir={dir ?? undefined}
          aria-hidden
          style={pill ? { left: pill.l, right: pill.r, ...(variant === "pill" ? { top: pill.t, bottom: pill.b } : null), opacity: 1 } : undefined}
        />
        {options.map((o) => {
          const on = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              name={name}
              tabIndex={on ? 0 : -1}
              disabled={o.disabled}
              data-seg-opt=""
              data-value={o.value}
              data-active={on || undefined}
              className="l-seg__opt l-focus"
              onClick={() => select(o.value)}
            >
              {o.icon && <span className="l-seg__icon">{o.icon}</span>}
              {/* Regular and medium weights share a cell, so selecting never shifts width. */}
              <span className="l-seg__label">
                <span className="l-seg__text">{o.label}</span>
                <span className="l-seg__text-on" aria-hidden>
                  {o.label}
                </span>
              </span>
              {o.count !== undefined && (
                <span className="l-seg__count l-num" key={o.count}>
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
