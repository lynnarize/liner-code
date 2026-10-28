/*
  Liner · Chip group
  Filters and quick choices as chips. A chosen chip fills with ink and a check grows in
  beside its label. Arrow keys move between chips; one or several can be on.
*/
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./chip-group.css";

export type Chip = { value: string; label: string; icon?: ReactNode; count?: number; disabled?: boolean };
export type ChipGroupProps = {
  chips: Chip[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (values: string[]) => void;
  /** One at a time, like radio buttons. */
  single?: boolean;
  label: string;
  size?: "sm" | "md";
  className?: string;
};

export function ChipGroup({ chips, value, defaultValue = [], onValueChange, single, label, size = "md", className }: ChipGroupProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const on = controlled ? value : inner;
  const row = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(() => Math.max(0, chips.findIndex((c) => on.includes(c.value))));

  const toggle = (v: string) => {
    const has = on.includes(v);
    const next = single ? (has ? [] : [v]) : has ? on.filter((x) => x !== v) : [...on, v];
    if (!controlled) setInner(next);
    onValueChange?.(next);
    feedback.play(has ? "tap" : "pop", has ? -1 : 3);
  };
  const move = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let i = focus;
    if (keys[e.key]) {
      do i = (i + keys[e.key] + chips.length) % chips.length;
      while (chips[i].disabled && i !== focus);
    } else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = chips.length - 1;
    else return;
    e.preventDefault();
    setFocus(i);
    row.current?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
  };

  return (
    <div ref={row} className={cx("l-chips", className)} data-size={size} role={single ? "radiogroup" : "group"} aria-label={label} onKeyDown={move}>
      {chips.map((c, i) => {
        const sel = on.includes(c.value);
        return (
          <button
            key={c.value}
            type="button"
            className="l-chip"
            role={single ? "radio" : "checkbox"}
            aria-checked={sel}
            data-on={sel || undefined}
            disabled={c.disabled}
            tabIndex={i === focus ? 0 : -1}
            onFocus={() => setFocus(i)}
            onClick={() => toggle(c.value)}
          >
            <span className="l-chip__check" aria-hidden>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {c.icon && !sel && <span className="l-chip__icon">{c.icon}</span>}
            <span>{c.label}</span>
            {c.count !== undefined && <span className="l-chip__count">{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
