/*
  Liner · Select
  One choice from a list. The trigger reads like a field; the list opens as glass with the
  current choice already highlighted, and typing jumps to a match.
*/
import { useId, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip, useRoving } from "../../lib/overlay";
import { OptionList, type SelectOption } from "./options";
import "../../lib/field.css";

export type { SelectOption };
export type SelectProps = {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label?: string;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function Select({ options, value, defaultValue, onValueChange, label, placeholder = "Choose…", description, disabled, className }: SelectProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const chosen = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, panel);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
  };
  useDismiss(open, () => close(false), [wrap]);
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (!controlled) setInner(o.value);
    onValueChange?.(o.value);
    feedback.play("tick", 4);
    close();
  };
  const nav = useRoving({
    count: options.length,
    skip: (i) => !!options[i]?.disabled,
    text: (i) => options[i]?.label ?? "",
    onPick: pick,
    onEscape: () => close(),
    onTab: () => close(false),
    initial: Math.max(0, options.findIndex((o) => o.value === current)),
  });

  const show = () => {
    nav.setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
  };

  return (
    <div className={cx("l-in l-select", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={wrap} className="l-anchor" style={{ display: "flex" }}>
        <button
          ref={btn}
          id={id}
          type="button"
          className="l-in-box l-trigger"
          disabled={disabled}
          data-disabled={disabled || undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-describedby={description ? `${id}-msg` : undefined}
          onClick={() => (open ? close() : show())}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              show();
            }
          }}
        >
          {chosen?.icon && <span className="l-in-icon">{chosen.icon}</span>}
          <span className="l-trigger-value" data-placeholder={!chosen || undefined} key={chosen?.value ?? "none"}>
            {chosen?.label ?? placeholder}
          </span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-trigger-chev">
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div
            ref={panel}
            className="l-pop l-listpop"
            data-side={side}
            data-align="start"
            tabIndex={-1}
            aria-activedescendant={nav.active >= 0 ? `${id}-list-${nav.active}` : undefined}
            onKeyDown={nav.onKeyDown}
          >
            <OptionList id={`${id}-list`} label={label ?? placeholder} options={options} nav={nav} isSelected={(v) => v === current} onPick={pick} />
          </div>
        )}
      </div>
      {description && (
        <span id={`${id}-msg`} className="l-in-hint">
          {description}
        </span>
      )}
    </div>
  );
}
