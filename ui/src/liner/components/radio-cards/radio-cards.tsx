/*
  Liner · Radio cards
  Choices that need a sentence or a price to decide between. Each is a white card; the
  chosen one draws an ink ring and its radio fills. Arrow keys move the choice, as radios do.
*/
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./radio-cards.css";

export type RadioCard = { value: string; title: string; description?: string; meta?: ReactNode; icon?: ReactNode; badge?: string; disabled?: boolean };
export type RadioCardsProps = {
  options: RadioCard[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
  /** Cards per row; defaults to fitting as many as there is room for. */
  columns?: number;
  className?: string;
};

export function RadioCards({ options, value, defaultValue, onValueChange, label, columns, className }: RadioCardsProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const root = useRef<HTMLDivElement>(null);
  const pick = (v: string, focus = false) => {
    if (v !== current) feedback.play("tick", 4);
    if (!controlled) setInner(v);
    onValueChange?.(v);
    if (focus) root.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus();
  };
  const enabled = options.filter((o) => !o.disabled);
  const onKey = (e: KeyboardEvent) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const at = enabled.findIndex((o) => o.value === current);
    pick(enabled[(at + dir + enabled.length) % enabled.length].value, true);
  };
  const tabbable = current ?? enabled[0]?.value;
  return (
    <div
      ref={root}
      className={cx("l-rcards", className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => {
        const on = o.value === current;
        return (
          <div
            key={o.value}
            className="l-rcard"
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            data-on={on || undefined}
            data-value={o.value}
            tabIndex={o.value === tabbable && !o.disabled ? 0 : -1}
            onClick={() => !o.disabled && pick(o.value)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                if (!o.disabled) pick(o.value);
              }
            }}
          >
            <span className="l-rcard__top">
              {o.icon && <span className="l-rcard__icon">{o.icon}</span>}
              <span className="l-rcard__radio" aria-hidden />
            </span>
            <span className="l-rcard__title">
              {o.title}
              {o.badge && <span className="l-rcard__badge">{o.badge}</span>}
            </span>
            {o.description && <span className="l-rcard__desc">{o.description}</span>}
            {o.meta && <span className="l-rcard__meta">{o.meta}</span>}
          </div>
        );
      })}
    </div>
  );
}
