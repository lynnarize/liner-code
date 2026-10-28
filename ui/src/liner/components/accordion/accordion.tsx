/*
  Liner · Accordion
  Sections that open in place. Panels grow to their own height (no measuring, no jumps),
  the chevron turns, and the content comes into focus as it arrives.
*/
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./accordion.css";

export type AccordionItem = { value: string; title: ReactNode; content: ReactNode; icon?: ReactNode; disabled?: boolean };
export type AccordionProps = {
  items: AccordionItem[];
  /** Let several stay open at once. */
  multiple?: boolean;
  defaultValue?: string[];
  value?: string[];
  onValueChange?: (open: string[]) => void;
  className?: string;
};

export function Accordion({ items, multiple, defaultValue = [], value, onValueChange, className }: AccordionProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const open = controlled ? value : inner;
  const toggle = (v: string) => {
    const was = open.includes(v);
    const next = was ? open.filter((x) => x !== v) : multiple ? [...open, v] : [v];
    if (!controlled) setInner(next);
    onValueChange?.(next);
    feedback.play(was ? "tap" : "tick", was ? -1 : 3);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const heads = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > .l-acc__item > h3 > button:not(:disabled)")];
    const at = heads.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: heads.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    heads[(to + heads.length) % heads.length]?.focus();
  };
  return (
    <div className={cx("l-acc l-frame-solo", className)} onKeyDown={onKey}>
      {items.map((it, i) => {
        const on = open.includes(it.value);
        return (
          <div key={it.value} className="l-acc__item" data-open={on || undefined}>
            <h3>
              <button type="button" id={`${id}-h${i}`} aria-expanded={on} aria-controls={`${id}-p${i}`} disabled={it.disabled} onClick={() => toggle(it.value)}>
                {it.icon && <span className="l-acc__icon">{it.icon}</span>}
                <span className="l-acc__title">{it.title}</span>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-acc__chev">
                  <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h3>
            <div className="l-acc__panel" id={`${id}-p${i}`} role="region" aria-labelledby={`${id}-h${i}`} inert={!on || undefined}>
              <div className="l-acc__clip">
                <div className="l-acc__content">{it.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
