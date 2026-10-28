/*
  Liner · Morph select
  The trigger becomes the list. Its own surface grows from the button's corner into a glass
  panel, the current choice still sitting where you pressed, and shrinks back around the
  new one.
*/
import { useId, useRef, useState, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useRoving } from "../../lib/overlay";
import "./morph-select.css";

export type MorphOption = { value: string; label: string; icon?: ReactNode; hint?: string };
export type MorphSelectProps = {
  options: MorphOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Names the choice, like "Sort by". */
  label: string;
  className?: string;
};

export function MorphSelect({ options, value, defaultValue, onValueChange, label, className }: MorphSelectProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = controlled ? value : inner;
  const chosen = options.find((o) => o.value === current) ?? options[0];
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useIsoLayoutEffect(() => {
    const b = btn.current;
    if (b) setSize({ w: b.offsetWidth, h: b.offsetHeight });
  }, [current]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
  };
  useDismiss(open, () => close(false), [root]);
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (!controlled) setInner(o.value);
    onValueChange?.(o.value);
    feedback.play("tick", 4);
    close();
  };
  const nav = useRoving({ count: options.length, text: (i) => options[i].label, onPick: pick, onEscape: () => close(), onTab: () => close(false) });

  return (
    <div ref={root} className={cx("l-msel", className)} data-open={open || undefined} style={{ ["--tw" as string]: `${size.w}px`, ["--th" as string]: `${size.h}px` }}>
      <button
        ref={btn}
        type="button"
        className="l-msel__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.label}`}
        onClick={() => {
          nav.setActive(Math.max(0, options.indexOf(chosen)));
          setOpen(true);
          requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
      >
        <span className="l-msel__label">{label}</span>
        <span className="l-msel__value" key={chosen?.value}>
          {chosen?.label}
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-msel__chev">
          <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        ref={panel}
        className="l-msel__panel"
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
        tabIndex={-1}
        aria-activedescendant={open ? `${id}-${nav.active}` : undefined}
        onKeyDown={nav.onKeyDown}
      >
        <div className="l-msel__head" aria-hidden onClick={() => close()}>
          <span className="l-msel__label">{label}</span>
          <span className="l-msel__value">{chosen?.label}</span>
          <svg viewBox="0 0 16 16" fill="none" className="l-msel__chev">
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="l-opts l-msel__opts" ref={nav.listRef}>
          {open && nav.hl && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === current}
              className="l-opt l-msel__opt"
              data-active={nav.active === i || undefined}
              style={{ ["--i" as string]: i }}
              onPointerMove={() => nav.active !== i && nav.setActive(i)}
              onClick={() => pick(i)}
            >
              {o.icon && <span className="l-opt-icon">{o.icon}</span>}
              <span className="l-opt-text">
                <span className="l-opt-label">{o.label}</span>
                {o.hint && <span className="l-opt-hint">{o.hint}</span>}
              </span>
              {o.value === current && (
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-opt-check">
                  <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
