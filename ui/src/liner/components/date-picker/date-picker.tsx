/*
  Liner · Date picker and Date range picker
  A field that opens a calendar on glass. The single picker offers a few quick days; the
  range picker puts common ranges beside two months and confirms with Apply, so a half-made
  range never leaks out.
*/
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip } from "../../lib/overlay";
import { Calendar } from "../calendar/calendar";
import { addDays, addMonths, startOfDay } from "../calendar/dates";
import { Button } from "../button/button";
import "../../lib/field.css";
import "./date-picker.css";

const CAL_ICON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 6.75h11M5.5 2v3M10.5 2v3" />
  </svg>
);

function usePopover() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, panel);
  useDismiss(open, () => setOpen(false), [wrap], btn);
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(".l-cal__day[tabindex='0']")?.focus({ preventScroll: true }));
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  };
  return { open, setOpen, wrap, btn, panel, side, close };
}

export type DatePickerProps = {
  value?: Date | null;
  defaultValue?: Date | null;
  onValueChange?: (date: Date | null) => void;
  label?: string;
  placeholder?: string;
  min?: Date;
  max?: Date;
  disabled?: (date: Date) => boolean;
  locale?: string;
  /** Quick days under the calendar. */
  presets?: { label: string; date: Date }[] | false;
  className?: string;
};

export function DatePicker({ value, defaultValue = null, onValueChange, label, placeholder = "Pick a date", min, max, disabled, locale = "en-US", presets, className }: DatePickerProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const pop = usePopover();
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const today = startOfDay(new Date());
  const quick =
    presets === false
      ? []
      : (presets ?? [
          { label: "Today", date: today },
          { label: "Tomorrow", date: addDays(today, 1) },
          { label: "Next week", date: addDays(today, 7) },
        ]);
  const set = (d: Date | null) => {
    if (!controlled) setInner(d);
    onValueChange?.(d);
  };
  return (
    <div className={cx("l-in l-datep", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={pop.wrap} className="l-anchor" style={{ display: "flex" }}>
        <button ref={pop.btn} id={id} type="button" className="l-in-box l-trigger" aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => pop.setOpen((o) => !o)}>
          <span className="l-in-icon">{CAL_ICON}</span>
          <span className="l-trigger-value" data-placeholder={!current || undefined} key={current?.toDateString() ?? "none"}>
            {current ? fmt.format(current) : placeholder}
          </span>
        </button>
        {pop.open && (
          <div ref={pop.panel} className="l-pop l-datep__pop" data-side={pop.side} data-align="start" role="dialog" aria-label={label ?? "Choose a date"}>
            <Calendar
              value={current}
              min={min}
              max={max}
              disabled={disabled}
              locale={locale}
              onValueChange={(d) => {
                set(d);
                window.setTimeout(pop.close, 140);
              }}
            />
            {quick.length > 0 && (
              <div className="l-datep__quick">
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      set(q.date);
                      feedback.play("tick", 3);
                      pop.close();
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type DateRange = { start: Date | null; end: Date | null };
export type DateRangePickerProps = {
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (range: DateRange) => void;
  label?: string;
  placeholder?: string;
  min?: Date;
  max?: Date;
  locale?: string;
  presets?: { label: string; range: () => DateRange }[];
  className?: string;
};

const defaultPresets: DateRangePickerProps["presets"] = [
  { label: "Last 7 days", range: () => ({ start: addDays(startOfDay(new Date()), -6), end: startOfDay(new Date()) }) },
  { label: "Last 30 days", range: () => ({ start: addDays(startOfDay(new Date()), -29), end: startOfDay(new Date()) }) },
  {
    label: "This month",
    range: () => {
      const t = new Date();
      return { start: new Date(t.getFullYear(), t.getMonth(), 1), end: new Date(t.getFullYear(), t.getMonth() + 1, 0) };
    },
  },
  {
    label: "Last month",
    range: () => {
      const t = addMonths(new Date(), -1);
      return { start: new Date(t.getFullYear(), t.getMonth(), 1), end: new Date(t.getFullYear(), t.getMonth() + 1, 0) };
    },
  },
  {
    label: "This quarter",
    range: () => {
      const t = new Date();
      const q = Math.floor(t.getMonth() / 3) * 3;
      return { start: new Date(t.getFullYear(), q, 1), end: new Date(t.getFullYear(), q + 3, 0) };
    },
  },
];

export function DateRangePicker({ value, defaultValue = { start: null, end: null }, onValueChange, label, placeholder = "Pick dates", min, max, locale = "en-US", presets = defaultPresets, className }: DateRangePickerProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [draft, setDraft] = useState<DateRange>(current);
  const [calKey, setCalKey] = useState(0);
  const pop = usePopover();
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!pop.open) return;
    setDraft(current);
    setWide(window.innerWidth > 640);
  }, [pop.open]);
  const short = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const full = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" });
  const text = (r: DateRange) => (r.start ? `${short.format(r.start)} – ${r.end ? full.format(r.end) : "…"}` : placeholder);
  const span = draft.start && draft.end ? Math.round((startOfDay(draft.end).getTime() - startOfDay(draft.start).getTime()) / 864e5) + 1 : 0;
  const apply = () => {
    if (!draft.start || !draft.end) return;
    if (!controlled) setInner(draft);
    onValueChange?.(draft);
    feedback.play("success");
    pop.close();
  };
  const presetOn = (p: NonNullable<DateRangePickerProps["presets"]>[number]) => {
    const r = p.range();
    return !!draft.start && !!draft.end && r.start?.toDateString() === draft.start.toDateString() && r.end?.toDateString() === draft.end.toDateString();
  };

  return (
    <div className={cx("l-in l-datep", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={pop.wrap} className="l-anchor" style={{ display: "flex" }}>
        <button ref={pop.btn} id={id} type="button" className="l-in-box l-trigger" aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => pop.setOpen((o) => !o)}>
          <span className="l-in-icon">{CAL_ICON}</span>
          <span className="l-trigger-value" data-placeholder={!current.start || undefined} key={text(current)}>
            {text(current)}
          </span>
        </button>
        {pop.open && (
          <div ref={pop.panel} className="l-pop l-datep__pop l-datep__range" data-side={pop.side} data-align="start" role="dialog" aria-label={label ?? "Choose dates"}>
            {presets && presets.length > 0 && (
              <div className="l-datep__presets" role="group" aria-label="Quick ranges">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    data-on={presetOn(p) || undefined}
                    onClick={() => {
                      setDraft(p.range());
                      setCalKey((k) => k + 1);
                      feedback.play("tick", 3);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="l-datep__main">
              <Calendar key={calKey} range={draft} onRangeChange={setDraft} min={min} max={max} locale={locale} months={wide ? 2 : 1} defaultMonth={draft.start ?? undefined} />
              <div className="l-datep__foot">
                <span key={span}>{draft.start && !draft.end ? "Pick an end date" : span ? `${span} ${span === 1 ? "day" : "days"}` : "Pick a start date"}</span>
                <span className="l-datep__btns">
                  <Button variant="ghost" size="sm" onClick={pop.close}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!draft.start || !draft.end} onClick={apply}>
                    Apply
                  </Button>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
