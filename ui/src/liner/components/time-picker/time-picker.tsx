/*
  Liner · Time picker
  Wheels, as on a phone: hours, minutes and AM/PM each scroll and snap to the band in the
  middle, and the ends fade as if the wheel curves away. TimeWheel works on its own;
  TimePicker puts it on glass under a field.
*/
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip } from "../../lib/overlay";
import "../../lib/field.css";
import "./time-picker.css";

/** Minutes since midnight. */
export type Time = number;
const ITEM = 36;

function Column({ items, index, onIndex, label }: { items: string[]; index: number; onIndex: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<number | undefined>(undefined);
  const last = useRef(index);
  // Follow the value from outside without fighting a scroll in progress.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ITEM) !== index) el.scrollTo({ top: index * ITEM, behavior: el.dataset.ready ? "smooth" : "auto" });
    if (el) el.dataset.ready = "";
  }, [index]);
  const onScroll = () => {
    const el = ref.current!;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM)));
    if (i !== last.current) {
      last.current = i;
      feedback.play("tick", i % 8);
    }
    window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => i !== index && onIndex(i), 90);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
    if (d) {
      e.preventDefault();
      onIndex(Math.max(0, Math.min(items.length - 1, index + d)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      onIndex(e.key === "Home" ? 0 : items.length - 1);
    }
  };
  return (
    <div
      ref={ref}
      className="l-wheel__col"
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={index}
      aria-valuetext={items[index]}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      onScroll={onScroll}
      onKeyDown={onKey}
    >
      {items.map((t, i) => (
        <div key={t} className="l-wheel__item" data-on={i === index || undefined} onClick={() => onIndex(i)}>
          {t}
        </div>
      ))}
    </div>
  );
}

export type TimeWheelProps = {
  value: Time;
  onValueChange: (t: Time) => void;
  hour12?: boolean;
  minuteStep?: number;
  className?: string;
};

export function TimeWheel({ value, onValueChange, hour12 = true, minuteStep = 5, className }: TimeWheelProps) {
  const h = Math.floor(value / 60) % 24;
  const m = value % 60;
  const hours = hour12 ? Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i)) : Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const mins = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => String(i * minuteStep).padStart(2, "0"));
  const pm = h >= 12;
  const set = (hh: number, mm: number) => onValueChange(((hh + 24) % 24) * 60 + mm);
  return (
    <div className={cx("l-wheel", className)}>
      <span className="l-wheel__band" aria-hidden />
      <Column label="Hour" items={hours} index={hour12 ? h % 12 : h} onIndex={(i) => set(hour12 ? i + (pm ? 12 : 0) : i, m)} />
      <span className="l-wheel__colon" aria-hidden>
        :
      </span>
      <Column label="Minute" items={mins} index={Math.round(m / minuteStep) % mins.length} onIndex={(i) => set(h, i * minuteStep)} />
      {hour12 && <Column label="AM or PM" items={["AM", "PM"]} index={pm ? 1 : 0} onIndex={(i) => set((h % 12) + (i ? 12 : 0), m)} />}
    </div>
  );
}

export const formatTime = (t: Time, locale = "en-US", hour12 = true) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 }).format(new Date(2000, 0, 1, Math.floor(t / 60), t % 60));

export type TimePickerProps = {
  value?: Time | null;
  defaultValue?: Time | null;
  onValueChange?: (t: Time) => void;
  label?: string;
  placeholder?: string;
  hour12?: boolean;
  minuteStep?: number;
  locale?: string;
  className?: string;
};

export function TimePicker({ value, defaultValue = null, onValueChange, label, placeholder = "Pick a time", hour12 = true, minuteStep = 5, locale = "en-US", className }: TimePickerProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, panel);
  useDismiss(open, () => setOpen(false), [wrap], btn);
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(".l-wheel__col")?.focus({ preventScroll: true }));
  }, [open]);
  const set = (t: Time) => {
    if (!controlled) setInner(t);
    onValueChange?.(t);
  };
  return (
    <div className={cx("l-in l-timep", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={wrap} className="l-anchor" style={{ display: "flex" }}>
        <button ref={btn} id={id} type="button" className="l-in-box l-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="l-in-icon" aria-hidden>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="8" cy="8" r="5.75" />
              <path d="M8 5v3.25l2.1 1.4" />
            </svg>
          </span>
          <span className="l-trigger-value" data-placeholder={current === null || undefined} key={current ?? "none"}>
            {current === null ? placeholder : formatTime(current, locale, hour12)}
          </span>
        </button>
        {open && (
          <div
            ref={panel}
            className="l-pop l-timep__pop"
            data-side={side}
            data-align="start"
            role="dialog"
            aria-label={label ?? "Choose a time"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setOpen(false);
                btn.current?.focus();
              }
            }}
          >
            <TimeWheel value={current ?? 9 * 60} onValueChange={set} hour12={hour12} minuteStep={minuteStep} />
          </div>
        )}
      </div>
    </div>
  );
}
