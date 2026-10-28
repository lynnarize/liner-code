/*
  Liner · Multi-select
  Several choices from a list, kept as chips in the field. Type to narrow, Enter to toggle,
  and the list stays open while you pick. Backspace once marks the last chip, twice removes it.
*/
import { useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip, useRoving } from "../../lib/overlay";
import { OptionList, type SelectOption } from "../select/options";
import "../../lib/field.css";
import "./multi-select.css";

export type MultiSelectProps = {
  options: SelectOption[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (values: string[]) => void;
  label?: string;
  placeholder?: string;
  max?: number;
  className?: string;
};

export function MultiSelect({ options, value, defaultValue = [], onValueChange, label, placeholder = "Add…", max, className }: MultiSelectProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const picked = controlled ? value : inner;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, box, panel);
  useDismiss(open, () => (setOpen(false), setQ("")), [wrap]);
  const full = max !== undefined && picked.length >= max;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [q, options]);

  const set = (next: string[]) => {
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };
  const toggle = (v: string) => {
    const on = picked.includes(v);
    if (!on && full) {
      feedback.play("error");
      return;
    }
    set(on ? picked.filter((x) => x !== v) : [...picked, v]);
    setArmed(false);
    feedback.play(on ? "tap" : "tick", on ? -1 : 4);
  };
  const nav = useRoving({
    count: shown.length,
    skip: (i) => !!shown[i]?.disabled || (full && !picked.includes(shown[i]?.value)),
    onPick: (i) => shown[i] && toggle(shown[i].value),
    onEscape: () => (setOpen(false), setQ("")),
    onTab: () => setOpen(false),
  });

  return (
    <div className={cx("l-in l-multi", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={wrap} className="l-anchor" style={{ display: "flex" }}>
        <div ref={box} className="l-in-box l-multi__box" data-open={open || undefined} onClick={() => (input.current?.focus(), setOpen(true))}>
          {picked.map((v, i) => {
            const o = options.find((x) => x.value === v);
            return (
              <span key={v} className="l-multi__chip" data-armed={(armed && i === picked.length - 1) || undefined}>
                {o?.label ?? v}
                <button
                  type="button"
                  className="l-multi__x"
                  aria-label={`Remove ${o?.label ?? v}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(v);
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="m5 5 6 6m0-6-6 6" />
                  </svg>
                </button>
              </span>
            );
          })}
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={open && nav.active >= 0 ? `${id}-list-${nav.active}` : undefined}
            aria-describedby={`${id}-count`}
            autoComplete="off"
            placeholder={picked.length ? "" : placeholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setArmed(false);
              nav.setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !q && picked.length) {
                if (armed) toggle(picked[picked.length - 1]);
                else setArmed(true);
                return;
              }
              setArmed(false);
              if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
                e.preventDefault();
                setOpen(true);
                return;
              }
              if (open && ["ArrowDown", "ArrowUp", "Enter", "Escape", "Home", "End"].includes(e.key)) nav.onKeyDown(e);
              else if (e.key === "Tab") setOpen(false);
            }}
          />
          <span id={`${id}-count`} className="l-multi__sr">
            {picked.length} selected
          </span>
        </div>
        {open && (
          <div ref={panel} className="l-pop l-listpop" data-side={side} data-align="start">
            <OptionList id={`${id}-list`} label={label ?? "Options"} options={shown} nav={nav} query={q} multi isSelected={(v) => picked.includes(v)} onPick={(i) => toggle(shown[i].value)} />
            <div className="l-multi__foot">
              <span key={picked.length}>
                {picked.length} {max ? `of ${max} ` : ""}selected
              </span>
              {picked.length > 0 && (
                <button type="button" className="l-multi__clear" onPointerDown={(e) => e.preventDefault()} onClick={() => set([])}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
