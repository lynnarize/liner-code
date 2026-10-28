/*
  Liner · Combobox
  Type to narrow a long list, then pick. The typed part of each label is picked out, and
  when nothing fits you can offer to create it. Leaving without picking puts the field back
  to the last choice.
*/
import { useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip, useRoving } from "../../lib/overlay";
import { OptionList, type SelectOption } from "../select/options";
import "../../lib/field.css";
import "./combobox.css";

export type ComboboxProps = {
  options: SelectOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** Offer to create what was typed when nothing matches exactly. */
  onCreate?: (text: string) => void;
  label?: string;
  placeholder?: string;
  description?: string;
  className?: string;
};

export function Combobox({ options, value, defaultValue = null, onValueChange, onCreate, label, placeholder = "Search…", description, className }: ComboboxProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const chosen = options.find((o) => o.value === current);
  const [text, setText] = useState(chosen?.label ?? "");
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, input, panel);

  const q = typing ? text.trim().toLowerCase() : "";
  const shown = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options), [q, options]);
  const canCreate = !!onCreate && !!q && !options.some((o) => o.label.toLowerCase() === q);
  const count = shown.length + (canCreate ? 1 : 0);

  const reset = () => {
    setOpen(false);
    setTyping(false);
    setText(chosen?.label ?? "");
  };
  useDismiss(open, reset, [wrap]);

  const pick = (i: number) => {
    if (i === shown.length && canCreate) {
      onCreate!(text.trim());
      setOpen(false);
      setTyping(false);
      feedback.play("pop", 3);
      return;
    }
    const o = shown[i];
    if (!o || o.disabled) return;
    if (!controlled) setInner(o.value);
    onValueChange?.(o.value);
    setText(o.label);
    setTyping(false);
    setOpen(false);
    feedback.play("tick", 4);
  };
  const nav = useRoving({ count, skip: (i) => !!shown[i]?.disabled, onPick: pick, onEscape: reset, onTab: reset, loop: true });

  return (
    <div className={cx("l-in l-combo", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={wrap} className="l-anchor" style={{ display: "flex" }}>
        <div className="l-in-box l-combo__box" data-open={open || undefined}>
          <span className="l-in-icon" aria-hidden>
            {chosen?.icon && !typing ? (
              chosen.icon
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7.2" cy="7.2" r="4.6" />
                <path d="m10.6 10.6 2.9 2.9" />
              </svg>
            )}
          </span>
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={open && nav.active >= 0 ? `${id}-list-${nav.active}` : undefined}
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            onFocus={(e) => e.target.select()}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setText(e.target.value);
              setTyping(true);
              setOpen(true);
              nav.setActive(0);
            }}
            onKeyDown={(e) => {
              if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setOpen(true);
                return;
              }
              if (open && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) nav.onKeyDown(e);
              else if (!open && e.key === "Escape" && text) {
                e.preventDefault();
                reset();
              } else if (open && e.key === "Tab") reset();
            }}
          />
          {current && !typing && (
            <button
              type="button"
              className="l-in-btn"
              aria-label="Clear"
              onClick={() => {
                if (!controlled) setInner(null);
                onValueChange?.(null);
                setText("");
                input.current?.focus();
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          )}
          <button type="button" className="l-in-btn" tabIndex={-1} aria-label="Show all" onClick={() => (setOpen((o) => !o), input.current?.focus())}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-trigger-chev">
              <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {open && (
          <div ref={panel} className="l-pop l-listpop" data-side={side} data-align="start">
            <OptionList
              id={`${id}-list`}
              label={label ?? "Options"}
              options={shown}
              nav={nav}
              query={q}
              isSelected={(v) => v === current}
              onPick={pick}
              empty={`Nothing matches “${text.trim()}”`}
              extra={
                canCreate && (
                  <div
                    id={`${id}-list-${shown.length}`}
                    data-index={shown.length}
                    role="option"
                    aria-selected={false}
                    className="l-opt l-combo__create"
                    data-active={nav.active === shown.length || undefined}
                    onPointerMove={() => nav.setActive(shown.length)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(shown.length)}
                  >
                    <span className="l-opt-icon" aria-hidden>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M8 3.5v9M3.5 8h9" />
                      </svg>
                    </span>
                    <span className="l-opt-text">
                      <span className="l-opt-label">
                        Create <b>“{text.trim()}”</b>
                      </span>
                    </span>
                  </div>
                )
              }
            />
          </div>
        )}
      </div>
      {description && <span className="l-in-hint">{description}</span>}
    </div>
  );
}
