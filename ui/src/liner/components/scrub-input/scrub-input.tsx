/*
  Liner · Scrub input
  A number you can drag. Pull the label left or right to scrub; Shift moves ten times as
  fast, Alt a tenth. Or type, including a little arithmetic like 24*2 or 100-12.
*/
import { useId, useRef, useState, type ReactNode } from "react";
import { clamp } from "../../lib/spring";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "../../lib/field.css";
import "./scrub-input.css";

export type ScrubInputProps = {
  label: string;
  /** A short glyph or letter shown as the handle instead of the label, like "W" or an icon. */
  handle?: ReactNode;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Places after the point. Taken from step when left out. */
  precision?: number;
  /** Pixels of drag per step. */
  sensitivity?: number;
  className?: string;
};

/** + - * / and brackets, nothing else. */
export function evaluate(src: string): number | null {
  const s = src.replace(/\s+/g, "").replace(/,/g, "");
  let i = 0;
  const atom = (): number => {
    if (s[i] === "(") {
      i++;
      const v = sum();
      if (s[i] !== ")") throw new Error("bracket");
      i++;
      return v;
    }
    if (s[i] === "-" || s[i] === "+") return s[i++] === "-" ? -atom() : atom();
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error("number");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const product = () => {
    let v = atom();
    while (s[i] === "*" || s[i] === "/") v = s[i++] === "*" ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (s[i] === "+" || s[i] === "-") v = s[i++] === "+" ? v + product() : v - product();
    return v;
  };
  try {
    const v = sum();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function ScrubInput({
  label,
  handle,
  value,
  defaultValue = 0,
  onValueChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  precision,
  sensitivity = 3,
  className,
}: ScrubInputProps) {
  const id = useId();
  const places = precision ?? (String(step).split(".")[1]?.length || 0);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [edge, setEdge] = useState<"min" | "max" | null>(null);
  const drag = useRef({ x: 0, start: 0, last: 0 });
  const input = useRef<HTMLInputElement>(null);

  const round = (v: number) => Number(clamp(Math.round(v / step) * step, min, max).toFixed(places));
  const set = (v: number) => {
    const next = round(v);
    if (next === current) return;
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };
  const fine = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
  const bounded = Number.isFinite(min) && Number.isFinite(max);
  const fill = bounded ? (current - min) / (max - min) : null;

  const commit = () => {
    if (draft === null) return;
    const v = evaluate(unit ? draft.replace(new RegExp(unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "") : draft);
    if (v !== null) set(v);
    setDraft(null);
  };

  return (
    <div className={cx("l-scrub", className)} data-scrubbing={scrubbing || undefined} data-edge={edge || undefined}>
      <span
        className="l-scrub__handle"
        aria-hidden
        title={`Drag to change ${label}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, start: current, last: current };
          setScrubbing(true);
          document.documentElement.style.cursor = "ew-resize";
        }}
        onPointerMove={(e) => {
          if (!scrubbing) return;
          const dx = e.clientX - drag.current.x;
          const raw = drag.current.start + (dx / sensitivity) * step * fine(e);
          const next = round(raw);
          if (next !== drag.current.last) {
            drag.current.last = next;
            feedback.play("tick", (next / step) % 8);
          }
          setEdge(raw <= min ? "min" : raw >= max ? "max" : null);
          set(raw);
        }}
        onPointerUp={() => {
          setScrubbing(false);
          setEdge(null);
          document.documentElement.style.cursor = "";
        }}
        onPointerCancel={() => {
          setScrubbing(false);
          setEdge(null);
          document.documentElement.style.cursor = "";
        }}
      >
        {handle ?? label}
      </span>
      <input
        ref={input}
        id={id}
        className="l-scrub__input"
        inputMode="decimal"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={current}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        aria-valuetext={unit ? `${current} ${unit}` : undefined}
        value={draft ?? `${current.toFixed(places)}${unit ?? ""}`}
        onFocus={(e) => {
          setDraft(current.toFixed(places));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") input.current?.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            input.current?.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = draft !== null ? (evaluate(draft) ?? current) : current;
            const next = round(base + (e.key === "ArrowUp" ? 1 : -1) * step * fine(e));
            if (!controlled) setInner(next);
            onValueChange?.(next);
            setDraft(next.toFixed(places));
          }
        }}
      />
      {fill !== null && <span className="l-scrub__fill" style={{ ["--f" as string]: fill }} aria-hidden />}
    </div>
  );
}
