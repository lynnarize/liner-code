/*
  Liner · Calendar
  A month you can move through. Months slide in the direction you go, today is marked with
  a small ring, and a range draws one continuous band from start to end. The grid is a real
  grid for screen readers and the arrow keys.
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { addDays, addMonths, before, between, monthGrid, sameDay, sameMonth, startOfDay, weekdayNames, weekStartFor } from "./dates";
import "./calendar.css";

export type CalendarProps = {
  /** Single date mode. */
  value?: Date | null;
  onValueChange?: (date: Date) => void;
  /** Range mode: pass range (and onRangeChange) instead of value. */
  range?: { start: Date | null; end: Date | null };
  onRangeChange?: (range: { start: Date | null; end: Date | null }) => void;
  min?: Date;
  max?: Date;
  /** Days that can't be picked. */
  disabled?: (date: Date) => boolean;
  locale?: string;
  /** The month shown first. */
  defaultMonth?: Date;
  /** Two months side by side (range mode). */
  months?: 1 | 2;
  className?: string;
};

export function Calendar({ value, onValueChange, range, onRangeChange, min, max, disabled, locale = "en-US", defaultMonth, months = 1, className }: CalendarProps) {
  const isRange = range !== undefined;
  const anchor = (isRange ? range.start : value) ?? defaultMonth ?? new Date();
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [dir, setDir] = useState<1 | -1>(1);
  const [focus, setFocus] = useState(() => startOfDay(anchor));
  const [hover, setHover] = useState<Date | null>(null);
  const weekStart = useMemo(() => weekStartFor(locale), [locale]);
  const days = useMemo(() => weekdayNames(locale, weekStart), [locale, weekStart]);
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const label = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const root = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);
  const today = startOfDay(new Date());

  const off = (d: Date) => (min && before(d, min)) || (max && before(max, d)) || !!disabled?.(d);
  const go = (n: number) => {
    setDir(n > 0 ? 1 : -1);
    setMonth((m) => addMonths(m, n));
    feedback.play("tick", n > 0 ? 5 : 2);
  };
  // The arrows move the focused day along, so Tab always lands in the month on screen.
  const step = (n: number) => {
    keyed.current = false;
    go(n);
    setFocus((f) => addMonths(f, n));
  };

  const pick = (d: Date) => {
    if (off(d)) return;
    feedback.play("tick", 4);
    setFocus(d);
    if (!isRange) return onValueChange?.(d);
    const { start, end } = range;
    // First press starts a range; the second ends it (in either order); a third starts over.
    if (!start || end) onRangeChange?.({ start: d, end: null });
    else onRangeChange?.(before(d, start) ? { start: d, end: start } : { start, end: d });
  };

  // Keep the focused day on screen, and move DOM focus with it when it came from the keyboard.
  useEffect(() => {
    const last = addMonths(month, months - 1);
    if (!sameMonth(focus, month) && !sameMonth(focus, last)) {
      const n = (focus.getFullYear() - month.getFullYear()) * 12 + focus.getMonth() - month.getMonth();
      go(n < 0 ? n : n - (months - 1));
    }
    if (keyed.current) root.current?.querySelector<HTMLElement>(`[data-day="${focus.toDateString()}"]`)?.focus();
  }, [focus]);

  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date | null = null;
    if (moves[e.key]) next = addDays(focus, moves[e.key]);
    else if (e.key === "PageUp") next = addMonths(focus, e.shiftKey ? -12 : -1);
    else if (e.key === "PageDown") next = addMonths(focus, e.shiftKey ? 12 : 1);
    else if (e.key === "Home") next = addDays(focus, -((focus.getDay() - weekStart + 7) % 7));
    else if (e.key === "End") next = addDays(focus, 6 - ((focus.getDay() - weekStart + 7) % 7));
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focus);
      return;
    } else return;
    e.preventDefault();
    keyed.current = true;
    setFocus(next);
    if (isRange && range.start && !range.end) setHover(next);
  };

  const pending = isRange && range.start && !range.end ? hover : null;
  const rs = isRange ? range.start : null;
  const re = isRange ? (range.end ?? pending) : null;

  const grid = (m: Date) => (
    <div className="l-cal__month" key={m.toISOString()} data-dir={dir}>
      <div className="l-cal__days" role="row">
        {days.map((d) => (
          <abbr key={d.long} title={d.long} role="columnheader" aria-label={d.long}>
            {d.short}
          </abbr>
        ))}
      </div>
      <div className="l-cal__grid" role="grid" aria-label={title.format(m)} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 6 }, (_, w) => (
          <div className="l-cal__week" role="row" key={w}>
            {monthGrid(m, weekStart)
              .slice(w * 7, w * 7 + 7)
              .map((d) => {
                const outside = !sameMonth(d, m);
                const selected = isRange ? sameDay(d, rs) || sameDay(d, re) : sameDay(d, value);
                const inRange = !!(rs && re && between(d, rs, re));
                const [lo, hi] = rs && re ? (before(re, rs) ? [re, rs] : [rs, re]) : [rs, rs];
                return (
                  <div role="gridcell" key={d.toDateString()} aria-selected={selected || inRange || undefined} className="l-cal__cell" data-band={(inRange && !outside) || undefined} data-band-start={(inRange && sameDay(d, lo)) || undefined} data-band-end={(inRange && sameDay(d, hi)) || undefined}>
                    {!outside && (
                      <button
                        type="button"
                        className="l-cal__day"
                        data-day={d.toDateString()}
                        data-today={sameDay(d, today) || undefined}
                        data-selected={selected || undefined}
                        disabled={off(d)}
                        tabIndex={sameDay(d, focus) ? 0 : -1}
                        aria-label={label.format(d)}
                        aria-current={sameDay(d, today) ? "date" : undefined}
                        onClick={() => pick(d)}
                        onPointerEnter={() => isRange && setHover(d)}
                        onFocus={() => setFocus(d)}
                      >
                        {d.getDate()}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={root} className={cx("l-cal", className)} data-months={months} onKeyDown={onKey} onPointerDown={() => (keyed.current = false)}>
      <div className="l-cal__head">
        <button type="button" className="l-cal__nav" aria-label="Previous month" onClick={() => step(-1)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M9.75 4.5 6.25 8l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="l-cal__titles" aria-live="polite">
          {Array.from({ length: months }, (_, i) => {
            const m = addMonths(month, i);
            return (
              <span key={m.toISOString()} className="l-cal__title" data-dir={dir}>
                {title.format(m)}
              </span>
            );
          })}
        </div>
        <button type="button" className="l-cal__nav" aria-label="Next month" onClick={() => step(1)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="l-cal__body">{Array.from({ length: months }, (_, i) => grid(addMonths(month, i)))}</div>
    </div>
  );
}
